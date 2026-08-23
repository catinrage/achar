/**
 * All user-facing UI strings, keyed by usage. Keeping them in one module
 * makes a future locale switch a data change instead of a code change.
 *
 * Diagnostics coming back from `@achar/core` are English and are shown
 * verbatim: they name events, axes and parameters that appear in the trace and
 * the VMID exactly as written, so translating them would make them harder to
 * match against the file, not easier.
 */
export const m = {
  appName: 'اچار',
  appTagline: 'تولید جی‌کد کارگاه',

  navGenerate: 'تولید برنامه',
  navHistory: 'تاریخچه',
  navMachines: 'ماشین‌ها',
  navAriaLabel: 'ناوبری اصلی',

  // Generate
  dropTitle: 'فایل Trace 5 را اینجا رها کنید',
  dropHint: 'یا برای انتخاب فایل کلیک کنید',
  dropActive: 'فایل را رها کنید',
  fileLabel: 'فایل انتخاب‌شده',
  clearFile: 'حذف فایل',
  machineLabel: 'ماشین',
  machinePlaceholder: 'یک ماشین انتخاب کنید',
  programNameLabel: 'نام برنامه (اختیاری)',
  programNameHint: 'خالی بگذارید تا از نام قطعه در فایل تریس استفاده شود',
  programNameInferred: 'از نام فایل گرفته شد — در صورت نیاز تغییر دهید',
  submit: 'تولید برنامه',
  submitting: 'در حال ارسال…',
  noMachines:
    'هنوز هیچ ماشینی تعریف نشده است. ابتدا از بخش «ماشین‌ها» یک ماشین اضافه کنید.',
  uploadProgress: 'در حال بارگذاری',

  // Job status
  statusQueued: 'در صف',
  statusRunning: 'در حال پردازش',
  statusDone: 'آماده',
  statusFailed: 'ناموفق',
  queuePosition: 'نفر {n} در صف',
  queueFirst: 'نفر بعدی',
  runningHint: 'پردازش فایل‌های بزرگ ممکن است تا یک دقیقه طول بکشد.',
  downloadTrace: 'فایل تریس اصلی',
  copyLink: 'کپی پیوند',
  linkCopied: 'پیوند کپی شد',
  cachedNotice:
    'این فایل قبلاً برای همین ماشین پردازش شده بود؛ همان خروجی نمایش داده می‌شود.',
  jobFailed: 'پردازش این فایل ناموفق بود',

  // Results
  tabFiles: 'فایل‌های جی‌کد',
  tabTiming: 'زمان چرخه',
  tabTools: 'ابزارها',
  downloadAll: 'دانلود همه (ZIP)',
  download: 'دانلود',
  view: 'نمایش',
  close: 'بستن',
  fileName: 'نام فایل',
  fileSize: 'حجم',
  fileLines: 'خطوط',
  noFiles: 'هیچ فایلی تولید نشد.',
  filesWord: 'فایل',
  copyCode: 'کپی',
  copied: 'کپی شد',

  // Diagnostics
  blockedTitle: 'این فایل تریس قابل تبدیل به جی‌کد نیست',
  blockedBody:
    'موارد زیر باید برطرف شوند. زمان چرخه و فهرست ابزارها همچنان قابل مشاهده است.',
  warningsTitle: 'هشدارها',
  warningsCount: '{n} هشدار',
  warningsShow: 'نمایش هشدارها',
  warningsBody: 'برنامه تولید شد، اما موارد زیر بررسی شوند.',
  severityError: 'خطا',
  severityWarning: 'هشدار',

  // Timing
  timingTotal: 'زمان کل',
  timingSetup: 'استقرار',
  timingTool: 'ابزار',
  timingJob: 'عملیات',
  timingCutting: 'براده‌برداری',
  timingLinking: 'حرکت‌های ارتباطی',
  timingDuration: 'مدت',
  timingInstances: 'دفعات',
  timingUnavailable: 'اطلاعات زمان‌بندی در این فایل موجود نیست.',

  // Tools
  toolId: 'شناسه ابزار',
  toolName: 'نام',
  toolType: 'نوع',
  toolDiameter: 'قطر',
  toolNumber: 'شماره',
  toolDuration: 'مدت کار',
  toolsUnavailable: 'فهرست ابزار در این فایل موجود نیست.',

  // History
  historyEmpty: 'هنوز هیچ برنامه‌ای تولید نشده است.',
  historyTrace: 'فایل تریس',
  historyMachine: 'ماشین',
  historyWhen: 'زمان',
  historyStatus: 'وضعیت',
  historyFiles: 'فایل‌ها',
  historyOpen: 'مشاهده',
  refresh: 'به‌روزرسانی',
  tracePurged: 'فایل تریس اصلی پاک شده است',

  // Machines
  machinesTitle: 'ماشین‌های کارگاه',
  machinesIntro:
    'تنظیمات هر ماشین فقط یک بار و در همین‌جا نگهداری می‌شود، تا خروجی همه برای یک فایل یکسان باشد.',
  machineNameLabel: 'نام ماشین',
  machineNamePlaceholder: 'مثلاً زیمنس ۸۲۸D چهار محور',
  machinePostLabel: 'پست‌پروسسور',
  machineVmidLabel: 'فایل VMID (اختیاری)',
  machineProfileLabel: 'پروفایل ماشین (اختیاری، JSON.)',
  machineAdd: 'افزودن ماشین',
  machineEdit: 'ویرایش',
  machineEditing: 'ویرایش ماشین',
  machineSave: 'ذخیره تغییرات',
  machineSaving: 'در حال ذخیره…',
  machineCancel: 'انصراف',
  machineKeepFile: 'فایل فعلی حفظ می‌شود',
  machineRemoveFile: 'حذف فایل فعلی',
  machineReplaceFile: 'جایگزینی با فایل جدید',
  machineAdding: 'در حال افزودن…',
  machineDelete: 'حذف',
  machineDeleteConfirm: 'این ماشین حذف شود؟ برنامه‌های تولیدشده باقی می‌مانند.',
  machinesEmpty: 'هیچ ماشینی تعریف نشده است.',
  machineHasVmid: 'همراه VMID',
  machineHasProfile: 'همراه پروفایل',
  chooseFile: 'انتخاب فایل',

  // Errors
  errorGeneric: 'خطایی رخ داد.',
  errorJobMissing: 'این برنامه یافت نشد. ممکن است حذف شده باشد.',
  errorNetwork: 'ارتباط با سرور برقرار نشد.',
  errorTooLarge: 'حجم فایل از حد مجاز این سرویس بیشتر است.',
  retry: 'تلاش دوباره',
  dismiss: 'بستن',
} as const;

/** Fills `{n}`-style placeholders. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
