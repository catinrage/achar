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
  uploadAnother: 'فایل دیگر',
  changeFile: 'تغییر فایل',
  noMachines:
    'هنوز هیچ ماشینی تعریف نشده است. ابتدا از بخش «ماشین‌ها» یک ماشین اضافه کنید.',
  uploadProgress: 'در حال بارگذاری',

  // Trace analysis
  analyzing: 'در حال خواندن فایل…',
  analyzingHint: 'فایل‌های بزرگ ممکن است تا یک دقیقه طول بکشد.',
  analysisFailed: 'این فایل خوانده نشد',
  traceCached:
    'این فایل قبلاً خوانده شده بود؛ نتیجه‌ی همان تحلیل نمایش داده می‌شود.',
  tracePart: 'قطعه',
  traceTotal: 'زمان کل قطعه',
  traceSetupsCount: '{n} استقرار',
  traceToolsCount: '{n} ابزار',
  traceStepUpload: 'انتخاب فایل',
  traceStepChoose: 'انتخاب استقرار و ماشین',
  traceStepResult: 'خروجی',

  // Setups
  setupsTitle: 'کدام استقرارها ساخته شود؟',
  setupsIntro:
    'اپراتور هر بار یک استقرار را روی ماشین اجرا می‌کند. فقط همان‌هایی را که الان می‌سازید انتخاب کنید.',
  setupsAll: 'همه استقرارها',
  setupsNone: 'هیچ‌کدام',
  setupsSelectedCount: '{n} از {total} استقرار انتخاب شده',
  setupsAllSelected: 'همه استقرارها انتخاب شده‌اند',
  setupsColumnIndex: 'شماره',
  setupsColumnName: 'نام',
  setupsColumnFixture: 'فیکسچر',
  setupsColumnHome: 'صفر قطعه',
  setupsColumnJobs: 'عملیات',
  setupsColumnDuration: 'مدت',
  setupsNoneInTrace:
    'این فایل استقرار مجزا ندارد و به صورت یک برنامه‌ی کامل ساخته می‌شود.',
  setupsImplicit:
    'در این فایل چند عملیات پیش از اولین استقرار اجرا می‌شوند. آن‌ها بخش مشترک برنامه‌اند و در هر انتخابی ساخته می‌شوند.',
  setupsKeepAllTools: 'نگه‌داشتن جدول کامل ابزارها',
  setupsKeepAllToolsHint:
    'به‌طور پیش‌فرض فقط ابزارهای استقرارهای انتخاب‌شده در فهرست ابزار و برنامه اندازه‌گیری می‌آیند.',
  setupsPartial: 'برنامه‌ی جزئی',
  setupsPartialBody:
    'این برنامه فقط شامل استقرار {setups} است. نام فایل‌ها با یک برنامه‌ی کامل یکسان است، پس آن‌ها را جدا نگه دارید.',
  setupsSelectAtLeastOne: 'دست‌کم یک استقرار را انتخاب کنید.',

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
  historyDelete: 'حذف از تاریخچه',
  historyDeleteConfirm:
    'این مورد از تاریخچه حذف شود؟ فایل‌های تولیدشده آن نیز پاک می‌شوند.',
  historyDeleteBusy: 'این کار هنوز تمام نشده است؛ پس از پایان آن را حذف کنید.',
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
  machineProfileLabel: 'مشخصات ماشین',
  machineProfileIntro:
    'همان چیزهایی که کنار ماشین می‌بینید. هر مورد را خالی بگذارید تا مقدار پیش‌فرض پست‌پروسسور اعمال شود.',
  machineControllerLabel: 'کنترل',
  machineControllerAuto: 'از پست‌پروسسور گرفته می‌شود',
  machineDialectLabel: 'شیوه‌ی نگارش خروجی',
  machineDialectDefault: 'پیش‌فرض',
  machineDialectHint: 'تفاوت در نحوه‌ی نوشته‌شدن متن جی‌کد است، نه در خود ماشین.',
  machineAxesLabel: 'تعداد محورها',
  machineExtendsLabel: 'بر پایه‌ی ماشین',
  machineExtendsNone: 'مستقل',
  machineExtendsHint: 'فقط تفاوت‌ها را بنویسید؛ بقیه از ماشین پایه گرفته می‌شود.',
  machineHomeLabel: 'نقطه‌ی خانه',
  machineReturnHomeLabel: 'نقطه‌ی بازگشت',
  machineHomeHint:
    'در ابتدا و انتهای هر برنامه فرستاده می‌شود؛ باید داخل محدوده‌ی حرکت VMID باشد.',
  machineFeaturesLabel: 'ویژگی‌های ماشین',
  machineFeatureDefault: 'پیش‌فرض',
  machineFeatureYes: 'دارد',
  machineFeatureNo: 'ندارد',
  machineFeatureUnset: '—',
  machineAdvanced: 'نمایش JSON این ماشین',
  machineAdvancedHint:
    'همان چیزی که ذخیره می‌شود. برای بازبینی است، ویرایش از طریق فرم انجام می‌شود.',
  machineNoProfile: 'هیچ مشخصه‌ای تنظیم نشده است.',
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
  machineHasProfile: 'همراه مشخصات',
  chooseFile: 'انتخاب فایل',

  // Errors
  errorGeneric: 'خطایی رخ داد.',
  errorJobMissing: 'این برنامه یافت نشد. ممکن است حذف شده باشد.',
  errorNetwork: 'ارتباط با سرور برقرار نشد.',
  errorTooLarge: 'حجم فایل از حد مجاز این سرویس بیشتر است.',
  errorTraceMissing: 'این فایل یافت نشد. دوباره بارگذاری کنید.',
  retry: 'تلاش دوباره',
  dismiss: 'بستن',
} as const;

/**
 * Persian names for the machine properties core declares.
 *
 * The form renders its inputs from core's schema, so a new property appears
 * without a code change — and, until it is listed here, appears with the
 * English label and description the schema carries. That is the trade made on
 * purpose: a missing translation is a readable field, where a hard-coded form
 * would have been a missing one.
 */
export const machineFeatureText: Record<
  string,
  { label: string; description: string }
> = {
  toolMeasurementProgram: {
    label: 'پروب اندازه‌گیری ابزار',
    description:
      'ماشین طول ابزار را اندازه می‌گیرد، پس تولید برنامه‌ی اندازه‌گیری معنا دارد.',
  },
  dwellAfterCoolantOn: {
    label: 'مکث پس از روشن‌شدن کولانت',
    description:
      'کولانت پس از M8 به مکث نیاز دارد تا پیش از شروع براده‌برداری به فشار برسد.',
  },
  dwellAfterCoolantOff: {
    label: 'مکث پس از خاموش‌شدن کولانت',
    description: 'کولانت پس از آخرین M9 به مکث نیاز دارد.',
  },
  tapCycleOptionalStop: {
    label: 'توقف اپراتور پیش از قلاویز',
    description:
      'پیش از هر سیکل قلاویزکاری یک توقف اختیاری گذاشته می‌شود تا اپراتور بررسی کند.',
  },
  maxSpindleSpeed: {
    label: 'بیشینه دور اسپیندل',
    description:
      'بیشترین دور اسپیندل. برنامه‌ای که دور بیشتری بخواهد ساخته نمی‌شود.',
  },
  toolChanger: {
    label: 'ابزارگردان',
    description:
      'نحوه‌ی تعویض ابزار. فعلاً فقط ثبت می‌شود و روی خروجی اثری ندارد.',
  },
};

/** Fills `{n}`-style placeholders. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
