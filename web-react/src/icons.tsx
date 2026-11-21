// 全站图标统一出口：语义名 -> Lucide。shadcn-admin 风格使用 1.75px 线稿。
import {
  Archive as LucideArchive,
  ArrowDown as LucideArrowDown,
  ArrowLeft as LucideArrowLeft,
  ArrowLeftRight as LucideArrowLeftRight,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  ArrowUpDown as LucideArrowUpDown,
  BookOpenText as LucideBookOpenText,
  Bug as LucideBug,
  CalendarCheck2 as LucideCalendarCheck2,
  ChartLine as LucideChartLine,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  Circle as LucideCircle,
  CircleCheck as LucideCircleCheck,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  ChevronsLeft as LucideChevronsLeft,
  ChevronsRight as LucideChevronsRight,
  ChevronsUpDown as LucideChevronsUpDown,
  Clipboard as LucideClipboard,
  Clock as LucideClock,
  CloudUpload as LucideCloudUpload,
  Copy as LucideCopy,
  Crop as LucideCrop,
  Download as LucideDownload,
  Droplet as LucideDroplet,
  ExternalLink as LucideExternalLink,
  Eye as LucideEye,
  Files as LucideFiles,
  Filter as LucideFilter,
  Folder as LucideFolder,
  FolderOpen as LucideFolderOpen,
  GripVertical as LucideGripVertical,
  History as LucideHistory,
  Image as LucideImage,
  Info as LucideInfo,
  Keyboard as LucideKeyboard,
  Languages as LucideLanguages,
  LayoutGrid as LucideLayoutGrid,
  Link2 as LucideLink2,
  List as LucideList,
  ListChecks as LucideListChecks,
  Lock as LucideLock,
  LockOpen as LucideLockOpen,
  LogOut as LucideLogOut,
  Maximize2 as LucideMaximize2,
  Moon as LucideMoon,
  MoreHorizontal as LucideMoreHorizontal,
  Paintbrush as LucidePaintbrush,
  Palette as LucidePalette,
  PanelLeft as LucidePanelLeft,
  Paperclip as LucidePaperclip,
  Pause as LucidePause,
  Pencil as LucidePencil,
  Play as LucidePlay,
  Plus as LucidePlus,
  QrCode as LucideQrCode,
  RefreshCw as LucideRefreshCw,
  RotateCcw as LucideRotateCcw,
  Scissors as LucideScissors,
  Search as LucideSearch,
  Send as LucideSend,
  Settings as LucideSettings,
  SlidersHorizontal as LucideSlidersHorizontal,
  Sparkles as LucideSparkles,
  Square as LucideSquare,
  Star as LucideStar,
  StickyNote as LucideStickyNote,
  Sun as LucideSun,
  Table2 as LucideTable2,
  Trash2 as LucideTrash2,
  Type as LucideType,
  Upload as LucideUpload,
  Video as LucideVideo,
  X as LucideX,
} from 'lucide-react'
import { createIcon, type AppIconProps } from './icons/base'

const StarGlyph = createIcon(LucideStar)

export const DashboardIcon = createIcon(LucideChartLine)
export const Plus = createIcon(LucidePlus)
export const Delete = createIcon(LucideTrash2)
export const Check = createIcon(LucideCheck)
export const Todo = createIcon(LucideListChecks)
export const Close = createIcon(LucideX)
export const Refresh = createIcon(LucideRefreshCw)
export const Search = createIcon(LucideSearch)
export const Edit = createIcon(LucidePencil)
export const CopyDocument = createIcon(LucideCopy)
export const DocumentCopy = createIcon(LucideFiles)
export const Download = createIcon(LucideDownload)
export const Upload = createIcon(LucideUpload)
export const UploadFilled = createIcon(LucideCloudUpload)
export const Paperclip = createIcon(LucidePaperclip)
export const Clock = createIcon(LucideClock)
export const InfoFilled = createIcon(LucideInfo)
export const Setting = createIcon(LucideSettings)
export const Sort = createIcon(LucideArrowUpDown)
export const ArrowLeft = createIcon(LucideArrowLeft)
export const Direction = createIcon(LucideArrowRight)
export const ArrowUp = createIcon(LucideArrowUp)
export const ArrowDown = createIcon(LucideArrowDown)
export const ArrowRight = createIcon(LucideChevronRight)
export const ChevronDown = createIcon(LucideChevronDown)
export const ChevronLeft = createIcon(LucideChevronLeft)
export const ChevronRight = createIcon(LucideChevronRight)
export const ChevronUp = createIcon(LucideChevronUp)
export const MoreFilled = createIcon(LucideMoreHorizontal)
export const MoreHoriz = createIcon(LucideMoreHorizontal)
export const Calendar = createIcon(LucideCalendarCheck2)
export const Collection = createIcon(LucideTable2)
export const Document = createIcon(LucideBookOpenText)
export const Fold = createIcon(LucidePanelLeft)
export const Expand = createIcon(LucidePanelLeft)
export const Memo = createIcon(LucideStickyNote)
export const Moon = createIcon(LucideMoon)
export const Sunny = createIcon(LucideSun)
export const SwitchButton = createIcon(LucideLogOut)
export const Translate = createIcon(LucideLanguages)
export const FilesIcon = createIcon(LucideFiles)
export const Files = createIcon(LucideFiles)
export const QrCodeIcon = createIcon(LucideQrCode)
export const Menu = createIcon(LucideList)
export const ListIcon = createIcon(LucideList)
export const Folder = createIcon(LucideFolder)
export const FolderOpened = createIcon(LucideFolderOpen)
export const Picture = createIcon(LucideImage)
export const AutoAwesome = createIcon(LucideSparkles)
export const Link = createIcon(LucideLink2)
export const ExternalLink = createIcon(LucideExternalLink)
export const View = createIcon(LucideEye)
export const Promotion = createIcon(LucideSend)
export const Switch = createIcon(LucideArrowLeftRight)
export const Favorite = createIcon(LucideStar)
export const FavoriteFilled = StarGlyph
export const StarBorder = StarGlyph
export const History = createIcon(LucideHistory)
export const Play = createIcon(LucidePlay)
export const Video = createIcon(LucideVideo)
export const Pause = createIcon(LucidePause)
export const Restore = createIcon(LucideRotateCcw)
export const Archive = createIcon(LucideArchive)
export const ContentPaste = createIcon(LucideClipboard)
export const GridView = createIcon(LucideLayoutGrid)
export const ViewList = createIcon(LucideList)
export const FilterList = createIcon(LucideFilter)
export const KeyboardArrowDown = createIcon(LucideChevronDown)
export const KeyboardArrowUp = createIcon(LucideChevronUp)
export const Keyboard = createIcon(LucideKeyboard)
export const Tune = createIcon(LucideSlidersHorizontal)
export const DragIndicator = createIcon(LucideGripVertical)
export const Crop = createIcon(LucideCrop)
export const AspectRatio = createIcon(LucideMaximize2)
export const Palette = createIcon(LucidePalette)
export const Brush = createIcon(LucidePaintbrush)
export const TextFields = createIcon(LucideType)
export const WaterDrop = createIcon(LucideDroplet)
export const ContentCut = createIcon(LucideScissors)
export const Lock = createIcon(LucideLock)
export const LockOpen = createIcon(LucideLockOpen)
export const RoundedCorner = createIcon(LucideSquare)
export const PanelLeftIcon = createIcon(LucidePanelLeft)
export const ChevronsUpDownIcon = createIcon(LucideChevronsUpDown)
export const ChevronsLeft = createIcon(LucideChevronsLeft)
export const ChevronsRight = createIcon(LucideChevronsRight)
export const CheckCircle = createIcon(LucideCheckCircle2)
export const Circle = createIcon(LucideCircle)
export const CircleCheck = createIcon(LucideCircleCheck)
export const BugIcon = createIcon(LucideBug)
export const LayoutIcon = createIcon(LucideLayoutGrid)
export const StorageIcon = createIcon(LucideArchive)
export const SpeedIcon = createIcon(LucideChartLine)
export const ReceiptIcon = createIcon(LucideClipboard)

/** 星标填充版；保留 Star/StarBorder 的旧语义。 */
export function Star(props: AppIconProps) {
  return <StarGlyph {...props} fill="currentColor" />
}

export function StarFilledIcon(props: AppIconProps) {
  return <StarGlyph {...props} fill="currentColor" />
}
