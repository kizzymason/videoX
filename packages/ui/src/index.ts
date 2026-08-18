/**
 * @videox/ui —— 跨端共用的**基础原语**与设计令牌。
 *
 * 边界：这里只放没有业务语义、没有布局倾向的东西（按钮、输入框、弹层、令牌、通用 hook）。
 * 视频卡片、侧边栏、瀑布流、底部 Tab 这类业务组件由 web-pc / web-mobile / admin
 * 各自实现——移动端的交互密度和手势模型跟 PC 差太远，强行共用只会让两边都别扭。
 */

export { cn } from './lib/cn.js';

export { Button, buttonVariants, type ButtonProps } from './components/button.js';
export { Input, Textarea } from './components/input.js';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  badgeVariants,
  Skeleton,
  Spinner,
  EmptyState,
  type EmptyStateProps,
} from './components/surface.js';
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetContentProps,
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from './components/overlay.js';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from './components/menu.js';
export { Label, Checkbox, Switch, Slider, Field, type FieldProps } from './components/form.js';
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  Progress,
  Separator,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './components/display.js';

export {
  useTheme,
  useMediaQuery,
  useDebouncedValue,
  useInfiniteSentinel,
  useInView,
  useLocalStorage,
  useCopy,
  type ThemeMode,
} from './hooks.js';
