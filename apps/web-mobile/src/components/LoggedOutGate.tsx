import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import { Avatar, AvatarFallback, Button } from '@videox/ui';
import { useSiteName } from '../hooks/use-site';

/** 未登录门禁：居中加大，只露头像、文案和登录/注册。 */
export function LoggedOutGate({
  subtitle,
  redirect,
}: {
  subtitle: string;
  redirect: string;
}) {
  const siteName = useSiteName();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-24 text-center">
      <Avatar className="size-24">
        <AvatarFallback className="bg-muted">
          <User className="size-10 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
      <div className="mt-6 space-y-2">
        <p className="text-[28px] leading-tight font-semibold tracking-tight">登录 {siteName}</p>
        <p className="text-[15px] text-muted-foreground">{subtitle}</p>
      </div>
      <Button asChild className="mt-8 h-14 w-full max-w-sm rounded-full text-base font-medium">
        <Link to={`/login?redirect=${encodeURIComponent(redirect)}`}>登录 / 注册</Link>
      </Button>
    </div>
  );
}
