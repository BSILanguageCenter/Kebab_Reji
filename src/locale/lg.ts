// ============================================================
// СПИСОК КЛЮЧЕЙ ПЕРЕВОДА
//
// Единственное место, где определены ключи.
// Каждый языковой файл (ru.ts, en.ts, uz.ts) импортирует
// отсюда тип TranslationKey и обязан перевести ВСЕ ключи.
//
// При добавлении нового ключа:
//   1. Добавьте строку в массив ниже
//   2. TypeScript сразу подсветит ru.ts / en.ts красным,
//      пока не добавите туда перевод
// ============================================================

export const translationKeys = [
  // ---------- App ----------
  'appName',
  'cashier',
  'kitchen',
  'manager',
  'online',
  'offline',
  'language',

  // ---------- Cashier ----------
  'activeOrders',
  'noActiveOrders',
  'statusReady',
  'statusCooking',
  'searchMenu',
  'orderTypeOutside',
  'orderTypeInside',
  'all',
  'tapItemsToAdd',
  'currentOrder',
  'lastOrder',
  'addComment',
  'total',
  'sendToKitchen',
  'sending',
  'clearAll',
  'printerError',
  'retryPrint',
  'each',
  'free',
  'quickAccess',

  // ---------- Kitchen ----------
  'kitchenDisplay',
  'newOrders',
  'preparing',
  'ready',
  'noNewOrders',
  'nothingCooking',
  'nothingReady',
  'noActiveOrdersLong',
  'waitingForOrders',
  'startPreparing',
  'markReady',
  'completeAndRemove',
  'note',
  'reprint',

  // ---------- Manager ----------
  'statistics',
  'menuManagement',
  'totalSales',
  'orders',
  'averageOrder',
  'inside',
  'outside',
  'salesByHour',
  'popularItems',
  'salesByCategory',
  'noSalesData',
  'today',
  'yesterday',
  'thisWeek',
  'thisMonth',
  'custom',
  'to',
  'categoriesAndItems',
  'categoryBtn',
  'itemBtn',
  'noItemsInCategory',
  'active',
  'inactive',
  'editCategory',
  'newCategory',
  'editItem',
  'newItem',
  'name',
  'shortName',
  'sortOrder',
  'cancel',
  'save',
  'saving',
  'fullName',
  'variant',
  'price',
  'image',
  'uploadImage',
  'uploading',
  'categoryCover',
  'categoryCoverHint',
  'removeCover',

  // ---------- Errors ----------
  'failedToLoadMenu',
  'failedToLoadStats',
  'failedToLoadOrders',
  'failedToSendOrder',
  'failedToUpdateStatus',
  'failedToDeleteOrder',
  'failedToDeleteCategory',
  'failedToDeleteItem',
  'failedToSaveCategory',
  'failedToSaveItem',
  'failedToUploadImage',
  'unknownError',

  // ---------- Confirmations ----------
  'deleteCategoryConfirm',
  'deleteItemConfirm',

  // ---------- Time ago ----------
  'timeAgoJustNow',
  'timeAgoMinutes',
  'timeAgoHours',
] as const;

export type TranslationKey = (typeof translationKeys)[number];