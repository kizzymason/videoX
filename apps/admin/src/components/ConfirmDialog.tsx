import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@videox/ui';

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  destructive?: boolean;
}

type Resolver = (ok: boolean) => void;

/**
 * 命令式确认框。后台里「删除/批量操作」的确认点太多，
 * 每处都摆一个受控 Dialog 会把页面组件撑爆，这里收敛成一次 await。
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactElement;
} {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: Resolver }) | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Dialog open={state !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="sm:max-w-100">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          {state?.description ? <DialogDescription>{state.description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            取消
          </Button>
          <Button variant={state?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {state?.confirmText ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
