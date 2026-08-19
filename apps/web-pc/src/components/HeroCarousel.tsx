import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Banner } from '@videox/shared';
import { cn } from '@videox/ui';
import { contentApi } from '../lib/api';
import { prefetchWatchPage } from '../lib/prefetch-watch';

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const navigate = useNavigate();
  const [emblaRef, embla] = useEmblaCarousel({ loop: true, align: 'start', duration: 26 }, [
    Autoplay({ delay: 5200, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);
  const [selected, setSelected] = React.useState(0);

  React.useEffect(() => {
    if (!embla) return undefined;
    const onSelect = () => setSelected(embla.selectedScrollSnap());
    embla.on('select', onSelect);
    onSelect();
    return () => {
      embla.off('select', onSelect);
    };
  }, [embla]);

  if (banners.length === 0) return null;

  const open = (banner: Banner) => {
    prefetchWatchPage();
    void contentApi.bannerClick(banner.id).catch(() => undefined);
    if (banner.videoId) navigate(`/watch/${banner.videoId}`);
    else if (banner.linkUrl) window.open(banner.linkUrl, '_blank', 'noopener');
  };

  return (
    <div className="group/hero relative">
      <div ref={emblaRef} className="overflow-hidden rounded-2xl">
        <div className="flex">
          {banners.map((banner) => (
            <button
              key={banner.id}
              type="button"
              onClick={() => open(banner)}
              className="group relative min-w-0 flex-[0_0_100%] text-left"
            >
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-muted">
                <img
                  src={banner.imageUrl}
                  alt={banner.title}
                  className="size-full object-cover transition-transform duration-700 ease-out-quint group-hover:scale-[1.02]"
                />
                {/* 左侧渐变压暗，保证白色标题在任何封面上都读得清 */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-transparent" />
                <div className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-center gap-2 p-10">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">{banner.title}</h2>
                  {banner.subtitle ? <p className="text-sm text-white/75">{banner.subtitle}</p> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {banners.length > 1 ? (
        <>
          <CarouselArrow direction="prev" onClick={() => embla?.scrollPrev()} />
          <CarouselArrow direction="next" onClick={() => embla?.scrollNext()} />
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
            {banners.map((banner, index) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`第 ${index + 1} 张`}
                onClick={() => embla?.scrollTo(index)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  index === selected ? 'w-6 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70',
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CarouselArrow({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === 'prev' ? '上一张' : '下一张'}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/55 focus-visible:opacity-100 group-hover/hero:opacity-100',
        direction === 'prev' ? 'left-4' : 'right-4',
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}
