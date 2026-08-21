#!/usr/bin/env bash
# 宿主机生产调优。幂等，可重复执行。
#
#   sudo bash deploy/host-tuning.sh
#
# 只做与 videoX 并发直接相关的部分：连接队列、端口与 fd 上限、拥塞控制、
# Docker 日志切分。业务参数在 docker-compose.prod.yml 与 .env 里。
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "需要 root 权限执行" >&2
  exit 1
fi

echo "==> 内核参数"
# BBR 在跨境长肥管道上比 cubic 明显更能吃满带宽，视频分发收益最大。
if modprobe tcp_bbr 2>/dev/null; then
  echo "tcp_bbr" > /etc/modules-load.d/videox-bbr.conf
  CC=bbr
  QDISC=fq
else
  echo "  内核不支持 bbr，保持 cubic"
  CC=cubic
  QDISC=fq_codel
fi

cat > /etc/sysctl.d/99-videox.conf <<EOF
# videoX 生产调优（deploy/host-tuning.sh 生成）

# --- 连接建立 ---------------------------------------------------------------
# nginx listen backlog 设到 8192，内核这一侧不能比它小，否则 SYN 直接被丢。
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 32768
net.ipv4.tcp_abort_on_overflow = 0

# --- 端口与 TIME_WAIT -------------------------------------------------------
# 反代到 API 是本机短连接，端口耗尽会直接表现为 502。
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_max_tw_buckets = 262144

# --- 吞吐 -------------------------------------------------------------------
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_slow_start_after_idle = 0
net.core.default_qdisc = ${QDISC}
net.ipv4.tcp_congestion_control = ${CC}

# --- 连接跟踪（Docker 的 NAT 转发都要过 conntrack）---------------------------
net.netfilter.nf_conntrack_max = 524288
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5

# --- 文件句柄 ---------------------------------------------------------------
fs.file-max = 2097152
fs.nr_open = 2097152
fs.inotify.max_user_watches = 524288

# --- 内存 -------------------------------------------------------------------
# swappiness=0 在没有 OOM 余量的机器上容易直接触发 OOM killer，留一点回旋。
vm.swappiness = 10
vm.overcommit_memory = 1
vm.max_map_count = 262144
# 转码会突发写入大文件，收紧回写窗口避免攒够几 GB 再一次性刷盘卡住整机。
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF

# sysctl --system 把 /etc/sysctl.conf 放在 /etc/sysctl.d/* 之后加载，云厂商镜像
# 预置在那里的值（如 tcp_max_syn_backlog=1024、swappiness=0）会盖掉上面的配置。
# 把冲突项注释掉，让 99-videox.conf 说话。
MANAGED_KEYS=$(grep -oE '^[a-z0-9_.]+ *=' /etc/sysctl.d/99-videox.conf | tr -d ' =')
if [[ -f /etc/sysctl.conf ]]; then
  CONFLICTS=()
  for key in $MANAGED_KEYS; do
    if grep -qE "^[[:space:]]*${key//./\\.}[[:space:]]*=" /etc/sysctl.conf; then
      CONFLICTS+=("$key")
      sed -i -E "s|^([[:space:]]*${key//./\\.}[[:space:]]*=.*)$|# \1  # 由 videox host-tuning.sh 接管|" /etc/sysctl.conf
    fi
  done
  if [[ ${#CONFLICTS[@]} -gt 0 ]]; then
    echo "  已从 /etc/sysctl.conf 移交：${CONFLICTS[*]}"
  fi
fi

sysctl --system >/dev/null
echo "  拥塞控制=$(sysctl -n net.ipv4.tcp_congestion_control) qdisc=$(sysctl -n net.core.default_qdisc)"
echo "  somaxconn=$(sysctl -n net.core.somaxconn) syn_backlog=$(sysctl -n net.ipv4.tcp_max_syn_backlog) swappiness=$(sysctl -n vm.swappiness)"

echo "==> 文件句柄上限"
cat > /etc/security/limits.d/99-videox.conf <<'EOF'
*     soft  nofile  1048576
*     hard  nofile  1048576
root  soft  nofile  1048576
root  hard  nofile  1048576
EOF

mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/99-videox.conf <<'EOF'
[Manager]
DefaultLimitNOFILE=1048576:1048576
DefaultTasksMax=infinity
EOF

echo "==> Docker 守护进程"
mkdir -p /etc/docker
NEEDS_DOCKER_RESTART=0
NEW_DAEMON=$(cat <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Soft": 65535, "Hard": 65535 }
  },
  "live-restore": true,
  "max-concurrent-downloads": 6,
  "max-concurrent-uploads": 6
}
EOF
)
if [[ ! -f /etc/docker/daemon.json ]] || ! diff -q <(echo "$NEW_DAEMON") /etc/docker/daemon.json >/dev/null 2>&1; then
  echo "$NEW_DAEMON" > /etc/docker/daemon.json
  NEEDS_DOCKER_RESTART=1
fi

systemctl daemon-reexec >/dev/null 2>&1 || true
if [[ $NEEDS_DOCKER_RESTART -eq 1 ]]; then
  # live-restore 让容器在 dockerd 重启期间继续跑，这里是热更新不是停服。
  systemctl reload docker 2>/dev/null || systemctl restart docker
  echo "  daemon.json 已更新"
else
  echo "  daemon.json 已是最新"
fi

echo "==> 交换分区"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  已创建 2G swap"
else
  echo "  swap 已存在：$(swapon --show=NAME,SIZE --noheadings | tr '\n' ' ')"
fi

echo "==> 完成。容器需要重建才能吃到新的 ulimit：docker compose -f docker-compose.prod.yml up -d"
