import net from 'node:net';

const targets = [
  { name: 'PostgreSQL', host: '127.0.0.1', port: 15433 },
  { name: 'Redis', host: '127.0.0.1', port: 6380 },
];

const TIMEOUT_MS = 90_000;

function probe({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(target) {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`等待 ${target.name} (${target.host}:${target.port}) `);
  while (Date.now() < deadline) {
    if (await probe(target)) {
      process.stdout.write(' 就绪\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write(' 超时\n');
  return false;
}

let ok = true;
for (const target of targets) {
  if (!(await waitFor(target))) ok = false;
}

if (!ok) {
  console.error('\n基础设施未就绪。请先执行 `npm run db:up` 并确认 Docker 正在运行。');
  process.exit(1);
}
console.log('\n基础设施全部就绪。');
