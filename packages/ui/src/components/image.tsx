import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface SmartImageProps extends Omit<React.ComponentProps<'img'>, 'onLoad' | 'onError'> {
  /** 加载完成后淡入；已经命中缓存的图片同一帧就显形，不会闪。 */
  fade?: boolean;
}

/**
 * 封面图。
 *
 * 直接裸用 <img> 的问题是：照片解码完成前那块区域是空的，解码的瞬间"啪"一下
 * 跳出来，列表里十几张图各跳各的，非常碎。这里统一在 onLoad 之后淡入，
 * 并且 src 变化时重置状态（切页签复用节点不会残留上一张的 loaded 标记）。
 */
export function SmartImage({ className, fade = true, src, alt, ...props }: SmartImageProps) {
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <img
      {...props}
      src={src}
      alt={alt}
      data-loaded={loaded}
      onLoad={() => setLoaded(true)}
      // 失败就不要一直挂着透明图，父级的 bg-muted 兜底即可。
      onError={() => setLoaded(false)}
      className={cn(fade && 'vx-img-fade', 'size-full object-cover', className)}
    />
  );
}
