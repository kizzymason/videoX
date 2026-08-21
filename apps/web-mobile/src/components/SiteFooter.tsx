import { cn } from '@videox/ui';
import { useSite } from '../hooks/use-site';

export function SiteFooter({ className }: { className?: string }) {
  const { data: site } = useSite();
  const year = new Date().getFullYear();
  const copy = site?.footerText?.trim() || `© ${year} ${site?.siteName?.trim() || 'PandaGV'}`;
  const icp = site?.icpBeian?.trim();
  const email = site?.contactEmail?.trim();

  return (
    <footer className={cn('space-y-1 px-1 py-4 text-center text-[11px] leading-relaxed text-muted-foreground', className)}>
      <p>{copy}</p>
      {icp || email ? (
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {icp ? (
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
              {icp}
            </a>
          ) : null}
          {email ? <a href={`mailto:${email}`}>{email}</a> : null}
        </p>
      ) : null}
    </footer>
  );
}
