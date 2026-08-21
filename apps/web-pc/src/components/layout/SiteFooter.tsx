import { cn } from '@videox/ui';
import { useSite } from '../../hooks/use-site';

/**
 * 前台页脚：文案、备案号、联系邮箱都来自后台「站点设置 → 基础信息」。
 * 页脚文案留空时回落到「© 年份 站点名称」。
 */
export function SiteFooter({ className }: { className?: string }) {
  const { data: site } = useSite();
  const year = new Date().getFullYear();
  const copy = site?.footerText?.trim() || `© ${year} ${site?.siteName?.trim() || 'PandaGV'}`;

  return (
    <footer className={cn('border-t border-border px-6 py-8 text-xs text-muted-foreground', className)}>
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2">
        <span>{copy}</span>
        {site?.icpBeian ? (
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {site.icpBeian}
          </a>
        ) : null}
        {site?.contactEmail ? (
          <a href={`mailto:${site.contactEmail}`} className="transition-colors hover:text-foreground">
            {site.contactEmail}
          </a>
        ) : null}
      </div>
    </footer>
  );
}
