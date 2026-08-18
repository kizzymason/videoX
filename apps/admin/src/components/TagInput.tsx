import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@videox/ui';

/** 回车 / 逗号成词，退格删末尾。视频标签量不大，不做联想面板。 */
export function TagInput({
  value,
  onChange,
  placeholder = '输入后回车',
  max = 20,
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  max?: number;
  className?: string;
}) {
  const [input, setInput] = React.useState('');

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const part of parts) {
      if (next.length >= max) break;
      if (!next.includes(part)) next.push(part);
    }
    onChange(next);
    setInput('');
  };

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20',
        className,
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {tag}
          <button
            type="button"
            aria-label={`移除 ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => {
          if (/[,，]/.test(e.target.value)) commit(e.target.value);
          else setInput(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(input);
          } else if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(input)}
        placeholder={value.length >= max ? `最多 ${max} 个` : placeholder}
        disabled={value.length >= max}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
