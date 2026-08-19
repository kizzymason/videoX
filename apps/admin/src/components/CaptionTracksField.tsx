import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Subtitles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { CaptionTrack } from '@videox/shared';
import {
  Button,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@videox/ui';
import { videosApi } from '../lib/api';
import { guessCaptionLang } from '../lib/caption-lang';

const LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
] as const;

function labelForLang(lang: string): string {
  return LANG_OPTIONS.find((item) => item.value === lang)?.label ?? lang;
}

export function CaptionTracksField({ videoId }: { videoId: string }) {
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [lang, setLang] = React.useState('zh');
  const [file, setFile] = React.useState<File | null>(null);

  const list = useQuery({
    queryKey: ['admin-captions', videoId],
    queryFn: () => videosApi.captions(videoId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-captions', videoId] });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择 VTT 或 SRT 文件');
      const content = await file.text();
      return videosApi.uploadCaption(videoId, { lang, filename: file.name, content });
    },
    onSuccess: async () => {
      toast.success('字幕已上传');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (trackLang: string) => videosApi.deleteCaption(videoId, trackLang),
    onSuccess: async () => {
      toast.success('字幕已删除');
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPick = (next: File | null) => {
    setFile(next);
    if (next) setLang(guessCaptionLang(next.name));
  };

  const tracks: CaptionTrack[] = list.data ?? [];

  return (
    <Field label="字幕" hint="仅 VTT / SRT。同一语言再传会覆盖。点播页有轨才显示 CC，Shorts 不挂字幕。">
      {tracks.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {tracks.map((track) => (
            <li
              key={`${track.lang}:${track.format}`}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs"
            >
              <Subtitles className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {labelForLang(track.lang)}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {track.lang} · {track.format.toUpperCase()}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                title="删除字幕"
                disabled={remove.isPending}
                onClick={() => remove.mutate(track.lang)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted-foreground">{list.isLoading ? '加载字幕…' : '还没有字幕轨'}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-[7.5rem_1fr_auto]">
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANG_OPTIONS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
            {LANG_OPTIONS.some((item) => item.value === lang) ? null : (
              <SelectItem value={lang}>{lang}</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          className="h-8 justify-start truncate px-2.5 text-xs font-normal"
          onClick={() => fileRef.current?.click()}
        >
          {file ? file.name : '选择 .vtt / .srt'}
        </Button>
        <Button
          type="button"
          className="h-8"
          disabled={!file || upload.isPending}
          onClick={() => upload.mutate()}
        >
          <Upload className="size-3.5" />
          上传
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".vtt,.srt,text/vtt,application/x-subrip"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </Field>
  );
}
