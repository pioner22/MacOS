export function shouldAutofocusComposer(opts: {
  coarsePointer: boolean;
  composerHadFocus: boolean;
  anyFinePointer?: boolean;
  hover?: boolean;
}): boolean {
  // Desktop-like: всегда фокусируем, чтобы можно было печатать без лишнего клика.
  if (!opts.coarsePointer) return true;

  // iPadOS и гибридные устройства могут иметь coarsePointer=true, но при этом пользователь взаимодействует мышью/трекпадом.
  // В таком случае автофокус ожидаем и он не воспринимается как "неожиданное" открытие клавиатуры.
  if (opts.anyFinePointer || opts.hover) return true;

  // Pure touch: тоже фокусируем — в PWA-режиме это ощущается как "приложение" (как минимум на Android),
  // а на iOS держим font-size>=16 и используем preventScroll, чтобы снизить шанс зума/скачков.
  return true;
}
