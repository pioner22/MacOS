import type { ChangelogEntry } from "./types";

export const CHANGELOG_PART_01: ChangelogEntry[] = [
  {
    version: "0.1.864",
    date: "2026-06-07",
    improved: [
      "PWA update: новое Web/PWA обновление теперь открывает явный prompt `Обновить`, показывает переход версии и применяет сборку через cache-busted navigation для iOS.",
      "Publish: обновлены downloadable clients для сайта после W-0959: Web/PWA, Android debug APK, macOS desktop ZIP/feed и CLI archive.",
      "Сайт downloads теперь должен показывать актуальные версии всех клиентов вместо старых Android/macOS/CLI артефактов.",
    ],
    fixed: [
      "Медиа: фото/видео со статусом `complete`, но без runtime URL, больше не блокируют повторное получение preview/file_get и должны восстанавливаться вместо вечной кнопки `Загрузить фото`.",
      "Android debug APK получил новый versionName/versionCode, чтобы sideload-клиенты видели отдельный новый артефакт.",
      "macOS desktop unsigned ZIP/feed пересобираются на текущей версии Web/PWA, а CLI archive пересобирается штатным dist pipeline.",
    ],
  },
  {
    version: "0.1.863",
    date: "2026-06-05",
    improved: [
      "Mobile/iOS: W-0959 переводит оформление сообщений ближе к Telegram: спокойные bubble colors, тонкие хвосты, меньше карточных теней и более аккуратный ритм текста.",
      "Время/статус у простых текстовых сообщений теперь встроены в пузырь как прозрачная inline-мета, без отдельного тяжёлого чипа.",
    ],
    fixed: [
      "Reply/forward previews больше не выглядят как тяжёлые карточки: оставлена тонкая акцентная линия и мягкий прозрачный фон.",
      "Сохранены compact selected-message menu, прозрачный нижний dock W-0957, auth Web version marker и принятый photo viewer.",
    ],
  },
  {
    version: "0.1.862",
    date: "2026-06-05",
    improved: [
      "Mobile/iOS: W-0958 полирует long-press меню сообщения под reference stack: emoji pill и action panel теперь одинаковой ширины 286px, с более крупными строками, иконками и стеклянной рамкой.",
      "Пузырьки сообщений получили современный outline/gloss слой, отдельный чип времени и более читаемую карточную обработку цитат/пересылок.",
    ],
    fixed: [
      "Меню выбора сообщения больше не возвращается к старой широкой геометрии 344px/252px и лучше совпадает с размером референса.",
      "Reply/forward блоки внутри сообщения больше не выглядят плоским текстом без рамки; время, статус и вложенный контекст не должны визуально спорить друг с другом.",
    ],
  },
  {
    version: "0.1.861",
    date: "2026-06-05",
    improved: [
      "Mobile/iOS: W-0957 делает нижний contact-list dock более прозрачным стеклянным слоем, чтобы список визуально проходил под нижней навигацией.",
      "Scroll reserve нижнего списка больше не добавляет глухой physical-bottom хвост: видимый reserve отделён от safe-area fill, а scroll-padding сохраняет защиту от скрытия последней строки.",
    ],
    fixed: [
      "Сохраняется исправленная ширина W-0956: нижняя капсула остаётся широкой, четыре кнопки не схлопываются в кучу.",
      "Чат с клавиатурой, selected-message menu, auth `Web` version marker и photo viewer regression guards не менялись.",
    ],
  },
  {
    version: "0.1.860",
    date: "2026-06-05",
    improved: [
      "Mobile/iOS: W-0956 закрепляет нижний dock списка как широкую капсулу на всю нижнюю строку, а не как блок шириной по содержимому.",
      "Для нижней навигации убран рискованный `width: min(...)`: теперь используются совместимые `flex-basis`, `width: calc(100% - 24px)`, `max-width` и `box-sizing`.",
    ],
    fixed: [
      "Нижнее меню больше не должно сжиматься в одну узкую кучку по центру: четыре вкладки снова получают отдельные равные колонки.",
      "Сохранены вертикальный offset из W-0955, auth `Web` version marker, selected-message menu, composer/keyboard state и photo viewer regression guards.",
    ],
  },
  {
    version: "0.1.859",
    date: "2026-06-05",
    improved: [
      "Mobile/iOS: W-0955 отделяет видимое положение нижнего dock от физического bottom fill, чтобы floating capsule оставалась целиком внутри видимой области телефона.",
      "Contact-list bottom navigation держит отдельную высоту visual row и не растягивает прозрачный контейнер до physical gap.",
    ],
    fixed: [
      "Нижнее меню больше не должно срезаться снизу и собираться в кучу на iPhone/PWA: scroll reserve сохранён через `--mobile-bottom-nav-h`, а сам dock поднят через `--mobile-bottom-nav-bottom-offset`.",
      "Auth `Web` version marker, selected-message context menu, accepted photo viewer chrome и composer/keyboard state сохранены regression guards.",
    ],
  },
  {
    version: "0.1.858",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0954 перестраивает long-press меню сообщения как reference stack: прозрачный контейнер, frameless reaction pill сверху и компактная action panel под выбранным сообщением.",
      "Нижняя навигация списка стала плавающей капсулой с видимыми подписями наших четырёх вкладок, вместо тяжёлого full-width бара и скрытых label.",
      "Modern skin получил мягкий patterned chat background, плоские строки списка с разделителем от текстовой колонки и composer с отдельными круглыми action-кнопками вокруг input-pill.",
    ],
    fixed: [
      "Modern skin больше не возвращает message action menu к старым 286px/48px параметрам W-0953.",
      "Android/mobile overrides больше не прячут подписи bottom dock; auth `Web` version marker, collapsed search и принятый compact photo viewer chrome сохранены regression guards.",
    ],
  },
  {
    version: "0.1.857",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0953 переводит long-press меню сообщения в отдельный iOS-like action list рядом с выбранной строкой: ширина 286px, строки 48px, крупные mask-icons и без лишних sub/meta подписей.",
      "Выбранное сообщение теперь используется как anchor для compact context menu, поэтому меню не выезжает sheet-слоем от края и не спорит с composer.",
      "Нижний contact-list dock растягивается на весь reserved bottom frame и держит четыре icon-кнопки как стабильную grid-навигацию.",
    ],
    fixed: [
      "Modern skin больше не возвращает меню сообщения к старым 300px/38px размерам.",
      "Android/mobile overrides больше не включают текстовую высоту tab-кнопок в нижнем dock; auth `Web` version marker и принятый compact photo viewer chrome сохранены regression guards.",
    ],
  },
  {
    version: "0.1.856",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0952 фиксирует contact-list bottom dock как стабильную 4-колоночную grid-навигацию без схлопывания вкладок в одну кучу.",
      "Message context menu на touch больше не открывается крупным bottom sheet: для сообщений используется компактное меню рядом с выбранным сообщением.",
      "При long-press выбранное сообщение получает Telegram-like highlight, а остальные строки, header и composer приглушаются blur/opacity-состоянием.",
    ],
    fixed: [
      "Android/mobile override больше не возвращает текстовые подписи в bottom dock, поэтому нижнее меню остаётся иконками одинаковой ширины.",
      "Auth `Web` version marker, collapsed search-лупа, compact photo viewer chrome и keyboard-open composer state сохранены как regression guards.",
    ],
  },
  {
    version: "0.1.855",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0951 делает contact-list bottom dock реальной нижней навигацией: общий `.sidebar-bottom-dock` больше не скрывает mobile dock, а вкладки занимают нижний physical frame.",
      "Поиск в мобильном списке стартует как кнопка-лупа и раскрывается в search input по фокусу, сохраняя фильтрацию контактов/групп/каналов.",
      "Context/action sheets стали уже и плотнее, с видимым close icon вместо пустого rounded square.",
    ],
    fixed: [
      "No-keyboard iOS/PWA composer теперь закреплён к `bottom: 0`, а нижний physical gap входит в padding самой панели, чтобы подвал не выглядел пустой полосой.",
      "Auth `Web` version marker, keyboard-open chat state и принятый compact photo viewer chrome сохранены как regression guards.",
    ],
  },
  {
    version: "0.1.854",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0950 переделал message context menu в modern action sheet с composer-aware геометрией, чтобы меню не спорило с полем ввода и клавиатурой.",
      "Пункты меню больше не используют emoji как action icons: строки получают stable `data-ctx-icon` tokens, а CSS рисует компактные mask-пиктограммы.",
      "Нижний contact-list dock усилен по высоте, контрасту и z-index, а вкладки `Контакты / Группы / Каналы / Меню` перешли с текстовых символов на semantic mask-icons.",
    ],
    fixed: [
      "Тёмная тема `yagodka-modern` больше не рисует context sheet тяжёлой зелёной плашкой; меню переведено в graphite/berry/teal palette.",
      "Auth `Web` version marker, keyboard-open chat state и принятый compact photo viewer chrome сохранены как regression guards.",
    ],
  },
  {
    version: "0.1.853",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0949 переносит `Контакты / Группы / Каналы / Меню` из верхнего tab chrome в rounded bottom navigation dock, который занимает нижний physical frame вместо пустой полосы.",
      "Contact list top chrome стал легче: сверху остаются search/status/title surfaces, а scroll body резервирует место под bottom dock через `--mobile-bottom-nav-h`.",
      "Mobile dark palette обновлена в сторону graphite/berry/teal contrast: меньше тяжёлого чёрно-зелёного, больше читаемого dock/composer/sidebar контраста.",
    ],
    fixed: [
      "iOS/PWA no-keyboard sidebar теперь использует `--app-logged-bottom-fill` как высоту нижнего navigation dock, поэтому persistent bottom frame становится частью UI.",
      "Chat composer, keyboard-open state, auth `Web` version marker и принятый compact photo viewer chrome сохранены как regression guards.",
    ],
  },
  {
    version: "0.1.852",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0948 переводит logged-in messenger на full-bleed overlay shell: `.grid`, `.sidebar`, `.chat-col` и `.chat` становятся full-frame сценами, а header/composer/sidebar sticky chrome накладываются сверху.",
      "Contact list/sidebar теперь скроллится в full-frame body под overlay tabs/search, а нижний physical frame учитывается через scroll padding вместо отдельного обрезанного main-row.",
    ],
    fixed: [
      "No-keyboard iOS/PWA снова использует physical `--app-logged-frame-vh` как canvas, но composer остаётся у visual edge через `--app-logged-bottom-fill`, поэтому нижняя область должна краситься без сдвига поля ввода вниз.",
      "Сохранены auth `Web` version marker, keyboard-open chat поведение, ручной `?__bottom_diag=1` и принятый compact photo viewer chrome.",
    ],
  },
  {
    version: "0.1.851",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0947 переделал logged-in messenger shell без старого `height: --app-logged-frame-vh`: fixed `#app` теперь заполняет no-keyboard frame через `top/bottom`, а внутренний `.app` держит `100%`.",
      "Contact list/sidebar остаётся отдельным full-frame scroll owner без left-slide перехода и без footer-row; chat composer в no-keyboard режиме использует compact live-pad вместо большого physical-pad.",
    ],
    fixed: [
      "Нижний физический участок больше не должен оставаться нерабочим хвостом под contact list/chat: строки списка и composer получают полный fixed frame, а viewer/auth/keyboard-open состояния остаются на своих visual-height контрактах.",
      "Сохранены auth `Web` version marker, ручная диагностика `?__bottom_diag=1` и принятый компактный photo viewer chrome.",
    ],
  },
  {
    version: "0.1.850",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: W-0946 diagnostic overlay на реальном телефоне показал `--app-frame-vh=956px`, но `--app-logged-frame-vh=894px` внутри `#app`.",
      "Auto diagnostic overlay отключён после снятия данных; ручной режим `?__bottom_diag=1` сохранён для повторной проверки при необходимости.",
    ],
    fixed: [
      "Logged-in no-keyboard shell теперь задаёт `--app-logged-frame-vh` и `--app-logged-bottom-fill` непосредственно на `#app`, поэтому локальный default больше не занижает каркас до visual viewport.",
      "Contact list/chat должны занимать physical frame 956px, while composer input остаётся у visual edge за счёт нижнего physical pad; auth, keyboard-open chat и принятый compact photo viewer не менялись.",
    ],
  },
  {
    version: "0.1.849",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: добавлен временный W-0946 diagnostic overlay для logged-in contact/chat shell с реальными viewport, rect, CSS var и elementFromPoint данными.",
      "Диагностика автоматически видна только на iOS mobile logged-in экране без клавиатуры и остаётся включаемой вручную через `?__bottom_diag=1`.",
    ],
    fixed: [
      "Web 0.1.848 подтверждён на телефоне, но lower mobile frame всё ещё не принят; следующий fix будет опираться на реальные rect/paint-owner значения, а не на очередной blind padding/height toggle.",
      "Auth version marker, keyboard-open chat state и принятый compact photo viewer не менялись.",
    ],
  },
  {
    version: "0.1.848",
    date: "2026-06-04",
    improved: [
      "Mobile/iOS: logged-in shell получил CSS fallback `--app-logged-frame-vh`, который берёт максимум из `--app-frame-vh`, `100dvh` и `--app-vh + physical bottom pad`.",
      "Нижний paint-owner теперь выбирается для активного logged-in surface: contact list/sidebar могут красить bottom frame `--sidebar-bg`, а chat/composer — composer surface.",
    ],
    fixed: [
      "Contact list и chat после Web 0.1.847 больше не зависят только от JS-класса `app-shell-physical-bottom`, поэтому нижняя тёмная область должна исчезнуть даже если real iOS/PWA geometry отдаёт неполный rect.",
      "Composer продолжает красить physical bottom frame, но поле ввода остаётся у visual edge; auth version marker и принятый компактный photo viewer не менялись.",
    ],
  },
  {
    version: "0.1.847",
    date: "2026-06-04",
    improved: [
      "Mobile/PWA: основной contacts/chat shell снова занимает полный physical frame через `--app-frame-vh`, чтобы нижний rounded-screen участок не оставался внешним слоем.",
      "Composer в physical-bottom режиме красит весь нижний frame через `--app-physical-bottom-pad`, но само поле ввода остаётся у visual edge.",
    ],
    fixed: [
      "Contact list и chat больше не должны заканчиваться над отдельной нижней тёмной полосой после входа в Web 0.1.846.",
      "Просмотр фото оставлен на visual viewport, чтобы не откатить принятый компактный mobile viewer chrome.",
    ],
  },
  {
    version: "0.1.846",
    date: "2026-06-04",
    improved: [
      "Mobile/PWA: общий каркас снова держит auth, contact list, chat и viewer внутри видимого viewport без растягивания на физический bottom-gap.",
      "Просмотр фото на телефоне получил компактный верхний слой: лишние действия скрыты, а скачать и закрыть стали крупными контрастными кнопками.",
    ],
    fixed: [
      "Contact list и composer больше не получают пустую нижнюю полосу от `--app-physical-bottom-pad`; внутри видимого экрана используется компактный live-pad.",
      "Маркер `Web`-версии на стартовом экране закреплён у нижнего края и снова виден без открытой клавиатуры.",
    ],
  },
  {
    version: "0.1.845",
    date: "2026-06-04",
    improved: [
      "Mobile/PWA: contact list теперь занимает один полный app frame без отдельной footer-строки и без бокового transform-slide при открытии.",
      "Mobile sidebar переведён на явный grid-каркас: sticky/header и scroll-body больше не конкурируют за высоту нижней физической области.",
    ],
    fixed: [
      "Экран входа снова показывает `Web`-версию внизу даже при фокусе поля пароля.",
      "Нижняя тёмная полоса под contact list больше не создаётся мобильным footer-row.",
    ],
  },
  {
    version: "0.1.844",
    date: "2026-06-04",
    improved: [
      "iPhone/PWA: нижний rounded-screen gap теперь берётся из `env(safe-area-inset-bottom)` даже если WebKit не показывает его через `screen.height - innerHeight`.",
    ],
    fixed: [
      "Исправлен случай, когда после Web 0.1.843 composer, список чатов и экран входа всё ещё оставляли отдельную нижнюю полосу на некоторых iPhone/PWA.",
    ],
  },
  {
    version: "0.1.843",
    date: "2026-06-04",
    improved: [
      "iPhone/PWA: нижняя физическая область теперь передаётся рабочим слоям как `--app-physical-bottom-pad`, поэтому sidebar, composer и viewer занимают весь rounded-screen frame.",
      "Просмотрщик фото привязан к реальной высоте stage: изображение больше не рассчитывается от старого `0.8 * app-vh` и не уезжает за верхние/нижние границы.",
    ],
    fixed: [
      "Убран остаточный пустой нижний кусок в mobile/PWA за счёт общего bottom-pad для нижних панелей вместо одного только `safe-bottom-pad`.",
      "Версия web-клиента на экране входа больше не накладывается на кнопку при открытой клавиатуре.",
    ],
  },
  {
    version: "0.1.842",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: физический rounded-screen низ теперь входит в единый app frame, поэтому chat, sidebar, composer и viewer больше не заканчиваются раньше края экрана.",
      "Экран проверки обновления показывает последовательные видимые стадии с task-bar вместо мгновенного зависания на первом пункте.",
    ],
    fixed: [
      "Убран повторный двойной учёт нижнего gap: composer и sidebar больше не дотягиваются отрицательным bottom/margin, а работают внутри общего frame-height.",
      "Мобильная авторизация и экран обновления используют общий `--app-frame-vh`, чтобы нижний фон и версия не жили отдельным внешним слоем.",
    ],
  },
  {
    version: "0.1.841",
    date: "2026-06-03",
    improved: [
      "Boot-layer теперь сам распознаёт stale PWA shell: если cached index ещё старой версии, а live `sw.js` уже новый, запуск не отдаёт пользователю старую визуальную сборку.",
      "При рассинхроне build id ранний `boot.js` сбрасывает Yagodka Service Worker/cache и перезапускает приложение через чистый `__boot_recover` до проверки нижнего iOS/PWA слоя.",
    ],
    fixed: [
      "Исправлен сценарий, когда после production deploy устройство продолжало показывать Web 0.1.839 и из-за этого новые safe-area правки 0.1.840 невозможно было увидеть на скриншотах.",
      "Обновление визуальных hotfix-сборок больше не зависит только от фонового auto-apply внутри старого app runtime, который мог ждать фокуса/idle и оставлять пользователя на старом CSS.",
    ],
  },
  {
    version: "0.1.840",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: внешний shell снова занимает физический rounded-screen низ, а внутренний рабочий слой остаётся на visual viewport, чтобы composer не уезжал за экран.",
      "Нижняя safe-area теперь входит в рабочие нижние слои sidebar и composer через общий `--app-layout-gap-bottom`, а не остаётся отдельным пустым canvas-подвалом.",
    ],
    fixed: [
      "После входа/перезахода тёмная нижняя зона больше не должна жить отдельно от списка и панели ввода: sidebar и composer продолжаются в физический PWA-низ.",
      "Закреплён iOS-контракт для экранов с округлением/home indicator: `#app` покрывает frame, `#app > .app` держит visual viewport, а нижние overlay-слои компенсируют gap отрицательным bottom.",
    ],
  },
  {
    version: "0.1.839",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: рабочий каркас мессенджера снова живёт на visual viewport, а физический rounded-screen низ красится общим canvas-слоем без сдвига composer ниже экрана.",
      "Мобильная авторизация перестала растягивать внутренние промежутки по высоте экрана: логотип, табы, поля и кнопки собраны в статичный верхний блок.",
    ],
    fixed: [
      "Исправлен регресс 0.1.838, где `--app-frame-vh` использовался как высота `#app` и из-за этого нижний composer частично уходил за видимый край.",
      "Уменьшен разрыв между табами входа/регистрации и формой на телефоне, чтобы низ экрана не выглядел отдельным оторванным слоем.",
    ],
  },
  {
    version: "0.1.838",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: основной каркас мессенджера теперь использует отдельную физическую высоту `--app-frame-vh`, поэтому chat/sidebar/composer занимают rounded-screen низ без внешней пустой полосы.",
      "Мобильная авторизация остаётся на визуальной высоте `--app-vh` и больше не наследует физический низ мессенджера.",
    ],
    fixed: [
      "Убрана нерабочая тёмная зона под composer/list после входа и перезахода: физический bottom gap больше не остаётся вне рабочего shell.",
      "На мобильном экране входа свободное место перенесено ниже формы, поэтому поля и кнопка регистрации не отрываются от табов.",
    ],
  },
  {
    version: "0.1.837",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: физический rounded-screen низ теперь используется как отдельная фоновая safe-area, а не прибавляется к рабочей высоте приложения.",
      "Мобильный `body` получает тот же safe-area фон, что и `html`, поэтому после boot/auth больше не проступает светлый внешний подвал.",
    ],
    fixed: [
      "Исправлен обрез нижних слоёв мессенджера: composer/list/chat больше не уходят ниже видимого viewport из-за завышенного `--app-vh`.",
      "Экран авторизации больше не оставляет большой пустой низ из-за привязки версии и формы к физической высоте screenshot-кадра.",
    ],
  },
  {
    version: "0.1.836",
    date: "2026-06-03",
    improved: [
      "PWA-каркас на iPhone с округлённым экраном теперь забирает в приложение увеличенный physical bottom gap до 180px, чтобы низ не оставался внешним пустым слоем.",
    ],
    fixed: [
      "Исправлен сценарий, когда на некоторых iPhone после входа или перезахода нижняя часть мессенджера оставалась неиспользованной, потому что viewport-helper отбрасывал слишком большой standalone gap.",
    ],
  },
  {
    version: "0.1.835",
    date: "2026-06-03",
    improved: [
      "Мобильный нижний каркас Web/PWA переведён на отдельный `live`-отступ: app-frame по-прежнему занимает физический низ iPhone, но видимые панели больше не получают двойной safe-area резерв.",
      "Экран авторизации на телефоне растянут в один статичный viewport: форма распределена по высоте, версия Web закреплена у нижнего края, а отдельная нижняя пустота больше не создаётся `auto`-отступом.",
    ],
    fixed: [
      "Composer чата и нижняя зона списка контактов больше не отступают от физического низа на полный PWA gap, из-за которого снизу появлялся неиспользованный кусок экрана.",
      "Default skin на iOS использует общий `--app-bottom-live-pad` вместо возврата к полному `--app-bottom-inset`, поэтому нижняя зона остаётся единой после входа и перезахода.",
    ],
  },
  {
    version: "0.1.834",
    date: "2026-06-03",
    improved: [
      "Ранний boot.js теперь распознаёт старый зависший экран `Обновляем приложение / Сбрасываем старый кэш` ещё до запуска app bundle.",
      "После обнаружения старого update-gate boot layer сам unregister service worker, очищает cache storage и перезапускает Web/PWA через clean recovery URL.",
    ],
    fixed: [
      "Исправлен сценарий, когда уже обновлённый сервер отдаёт свежий Web, но старый cached JS продолжает держать клиента на прежнем экране cache reset.",
      "Версия Web остаётся видимой после аварийного recovery, чтобы на скрине было понятно, какая сборка реально дошла до устройства.",
    ],
  },
  {
    version: "0.1.833",
    date: "2026-06-03",
    improved: [
      "Web/PWA startup больше не блокирует вход в мессенджер из-за расхождения live BUILD_ID: новая версия подтягивается в фоне, а текущий клиент открывается без обязательного reload-цикла.",
      "Версия Web теперь видна на раннем boot screen, recovery screen, экране авторизации, публичном сайте, странице статуса и в downloads manifest.",
      "Нижние diagnostic markers переведены в debug-only режим: их можно включить через `?__bottom_diag=1`, но обычный production-вход их не показывает.",
    ],
    fixed: [
      "Устранён повторный сценарий вечного экрана `Обновляем приложение`: даже при старом PWA/cache клиент получает finite status и переходит к запуску приложения.",
      "Публичный сайт автоматически подставляет реальные версии Web, Android и macOS из build artifacts, чтобы было понятно, какая поставка опубликована на yagodka.org.",
    ],
  },
  {
    version: "0.1.832",
    date: "2026-06-03",
    improved: [
      "Экран проверки обновлений Web/PWA переработан на контрастную поверхность: текст, шаги, progress и кнопки больше не зависят от текущей темы и не сливаются с фоном на телефоне или desktop.",
      "Публичные клиенты сайта перепривязаны к свежей поставке: Android debug APK получил новый versionCode/versionName, а web deploy сохраняет старые hashed assets для безопасного выхода старых клиентов из обновления.",
    ],
    fixed: [
      "Исправлен deadlock старых Web/PWA клиентов: проверка live build теперь имеет жёсткий timeout, после исчерпания попыток запускает текущий bundle вместо вечного экрана обновления, а boot.js показывает ранний recovery screen с действиями.",
      "Service Worker navigation теперь сначала пробует сеть и только затем cached shell, чтобы установленный клиент мог уйти со старого index.html после production deploy.",
      "Исправлен нижний обрез основного мессенджера на iPhone/PWA: дефолтный skin больше не перебивает общий `--app-bottom-inset` сырым `env(safe-area-inset-bottom)`, поэтому composer и sidebar используют тот же rounded-screen gap, что и app-frame.",
    ],
  },
  {
    version: "0.1.831",
    date: "2026-06-03",
    improved: [
      "Web/PWA update gate получил понятный task-bar: шаги проверки версии, подготовки обновления, очистки кэша, перезапуска и запуска приложения теперь отображаются пользователю с прогрессом и анимацией.",
      "iPhone/PWA bottom diagnostics больше не перекрывают основные действия: PHYSICAL-BOTTOM и APP-FRAME-BOTTOM подняты над нижним интерактивным слоем для контрольных скринов.",
    ],
    fixed: [
      "Исправлен Mozilla/Firefox update loop: после ограниченного числа автоматических попыток экран обновления останавливается в конечном состоянии с кнопками `Открыть приложение` и `Повторить обновление`, без бесконечных reload/cache reset.",
      "Исправлен нижний каркас iOS standalone: app-frame больше не уходит ниже физического экрана через отрицательный bottom/spill, а rounded-screen gap остаётся внутренним safe-area inset для auth, sidebar и chat composer.",
    ],
  },
  {
    version: "0.1.830",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA shell: boot/loading теперь получает тот же светлый canvas на html/body, а не только внутри #app, чтобы нижняя физическая область не наследовала тёмный mobile skin.",
      "Mobile diagnostics: PHYSICAL-BOTTOM и APP-FRAME-BOTTOM дополнены spill=..., чтобы на screenshots было видно, расширяет ли app-frame физический низ устройства.",
    ],
    fixed: [
      "Исправлен оставшийся state-dependent нижний дефект: в iOS standalone app-frame расширяется вниз на physical bottom gap только когда клавиатура закрыта, без отдельного pseudo-footer и без вмешательства в keyboard layout.",
    ],
  },
  {
    version: "0.1.829",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: добавлен единый host-canvas фон для html/body/#app, meta theme-color и mobile sidebar/auth states, чтобы rounded-screen низ не наследовал старый тёмный launch canvas.",
      "PWA shell: initial boot screen переведён на светлый auth-safe canvas с отдельным background-color под градиентом, а manifest description обновлён под корпоративный мессенджер.",
    ],
    fixed: [
      "Исправлен остаточный нижний тёмный обрубок, который не реагировал на CSS pseudo-footer: теперь самый внешний root/PWA canvas получает тот же solid фон, что и текущий auth или sidebar экран.",
    ],
  },
  {
    version: "0.1.828",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: нижний physical gap теперь остаётся частью app host, а не отдельным pseudo-footer слоем поверх текущего экрана.",
      "Mobile debug: gap/layout/kbd diagnostics сохранены, чтобы проверить, что outer host дошёл до самого rounded-screen bottom.",
    ],
    fixed: [
      "Убран остаточный тёмный нижний обрубок после 0.1.827: frame-bottom paint больше не рисуется отдельной полосой, когда --app-vh уже включает physical bottom.",
    ],
  },
  {
    version: "0.1.827",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: physical bottom теперь отделён от keyboard/visualViewport state, чтобы rounded-screen низ не превращался в ложный keyboard mode.",
      "Mobile debug: нижние diagnostic markers дополнены layout gap и keyboard flag для точной проверки app-frame ownership на screenshots.",
    ],
    fixed: [
      "Исправлен остаточный тёмный physical bottom strip: app-frame красит реальный device bottom, а layout padding отдельно отключается только для настоящей клавиатуры.",
    ],
  },
  {
    version: "0.1.826",
    date: "2026-06-03",
    improved: [
      "iPhone/PWA: app shell теперь владеет полным physical bottom gap до 120px, а не сжимает его до safe-area/44px.",
      "Mobile debug: добавлены видимые метки PHYSICAL-BOTTOM, APP-FRAME-BOTTOM, AUTH-SCROLL-END, SIDEBAR-SCROLL-END и CHAT-COMPOSER-BOTTOM для точной проверки нижнего каркаса на скринах.",
    ],
    fixed: [
      "Исправлен оставшийся нижний обрубок на rounded iPhone/PWA: auth, sidebar, chat composer и общий app-frame используют один bottom inset от корневого viewport.",
    ],
  },
  {
    version: "0.1.825",
    date: "2026-06-03",
    improved: [
      "Web/PWA mobile shell переведён на единый app-frame: boot, auth и основной мессенджер теперь живут внутри одного владельца viewport/background/safe-area.",
    ],
    fixed: [
      "Исправлен плавающий нижний дефект после входа/перезахода: auth больше не отключает fixed iOS frame, loading не оставляет самостоятельный тёмный низ, а auth scroll остаётся внутренним слоем приложения.",
    ],
  },
  {
    version: "0.1.824",
    date: "2026-06-03",
    improved: [
      "Web/PWA получил единый mobile bottom contract: iPhone/PWA safe-area gap теперь входит в высоту app shell, а composer, chat history, sidebar/contact list и auth используют общий bottom inset.",
    ],
    fixed: [
      "Исправлен глобальный нижний обрез на rounded iPhone/PWA: мессенджер больше не отделяет низ внешним тёмным подвалом, а marker `Обновлено` на auth прижат к нижней safe-area.",
    ],
  },
  {
    version: "0.1.823",
    date: "2026-06-03",
    improved: [
      "Мобильный auth Web/PWA переведён на iPhone-safe scroll-root: нижняя safe-area теперь часть прокручиваемой страницы, а не отдельный fixed-подвал.",
    ],
    fixed: [
      "Убран тёмный нижний обрубок на rounded iPhone/PWA: auth больше не рисует fixed pseudo-footer, корневые слои получают единый фон, а iOS status-bar mode больше не использует black-translucent для экрана входа.",
    ],
  },
  {
    version: "0.1.822",
    date: "2026-06-03",
    improved: [
      "Мобильный экран авторизации Web/PWA получил видимую нижнюю safe-area зону и аккуратный marker `Обновлено 0.1.822`, чтобы на телефоне было понятно, что открыт новый экран.",
    ],
    fixed: [
      "Низ auth screen теперь закрывается отдельным светлым continuation-band вместо незаметной theme-only правки: чёрный обрубок на iPhone/PWA должен визуально исчезнуть и быть проверяемым по скриншоту.",
    ],
  },
  {
    version: "0.1.821",
    date: "2026-06-03",
    improved: [
      "Web/PWA auth теперь обновляет browser/PWA chrome color под светлый экран входа, чтобы установленная PWA не оставляла старый тёмный цвет вокруг safe-area.",
    ],
    fixed: [
      "Manifest и initial theme-color переведены на светлый auth-safe-area фон: это закрывает случай, когда production уже обновлён, но iPhone/PWA продолжает рисовать чёрный низ вне CSS-области.",
    ],
  },
  {
    version: "0.1.820",
    date: "2026-06-03",
    improved: [
      "Мобильный экран авторизации Web/PWA теперь сам задаёт фон для всей высоты экрана, включая нижнюю safe-area/home-indicator область на iPhone.",
    ],
    fixed: [
      "Убран тёмный обрубок внизу auth entry: фон html/body/#app/overlay и нижнего псевдо-слоя синхронизирован, а высота учитывает iOS PWA gap без возврата прокрутки.",
    ],
  },
  {
    version: "0.1.819",
    date: "2026-06-03",
    improved: [
      "Мобильный экран авторизации Web/PWA переработан в цельный messenger-style first screen: вместо отдельной карточки поверх фона логотип, заголовок, форма, tabs и CTA читаются как единая поверхность входа.",
    ],
    fixed: [
      "В auth entry убрано ощущение оторванного внутреннего слоя: мобильная панель больше не использует рамку, тень и отдельный фон, при этом no-scroll и статичная геометрия Создать/Вход сохранены.",
    ],
  },
  {
    version: "0.1.818",
    date: "2026-06-02",
    improved: [
      "Мобильный экран авторизации Web/PWA заново переработан после визуальной неприёмки: фон стал светлее и чище, карточка поднята выше, края и controls получили более современное округление.",
    ],
    fixed: [
      "Телефонная auth-карточка сохраняет статичную no-scroll геометрию входа/регистрации, но primary-кнопка, tabs, поля и notice больше не выглядят как грубая старая прямоугольная оболочка.",
    ],
  },
  {
    version: "0.1.817",
    date: "2026-06-02",
    improved: [
      "Мобильный экран авторизации Web/PWA переработан после визуального замечания: вместо плоской полноэкранной белой панели используется более собранная mobile shell с аккуратным фоном, компактной верхней зоной, мягкими полями и читаемой primary-кнопкой.",
    ],
    fixed: [
      "Телефонная версия auth entry сохраняет no-scroll и fixed login/register geometry: переключение `Создать`/`Вход`, уведомление, поля и кнопки остаются в стабильных слотах без возврата старых прыжков.",
    ],
  },
  {
    version: "0.1.816",
    date: "2026-06-02",
    improved: [
      "Экран авторизации Web/PWA переделан заново после визуальной неприёмки: тёмный декоративный watermark-фон заменён на чистую нейтральную корпоративную поверхность с обычной бренд-зоной и небольшим логотипом.",
    ],
    fixed: [
      "Кнопка закрытия auth-панели закреплена в верхней строке панели, а не наследует абсолютное позиционирование общего modal-auth правила; fixed geometry входа/регистрации сохранена.",
    ],
  },
  {
    version: "0.1.815",
    date: "2026-06-02",
    improved: [
      "Окно авторизации Web/PWA получило единую корпоративную поверхность с логотипом Ягодки в фоне: серый отдельный блок заменён на спокойный брендированный вход без изменения геометрии формы.",
    ],
    fixed: [
      "Вход, регистрация и возврат после выхода сохраняют жёсткую статичную компоновку: фон, панель, логотип, кнопки и описания больше не должны визуально перескакивать при переключении режимов.",
    ],
  },
  {
    version: "0.1.814",
    date: "2026-06-02",
    improved: [
      "Экран авторизации Web/PWA упрощён для пользователя: из окна убраны технические статусы, progress-шаги, сессионные карточки и служебные формулировки про сервер/версию/устройство.",
      "Вход и регистрация теперь используют один жёсткий каркас формы с фиксированными слотами заголовка, уведомления, полей, подсказки и кнопки, чтобы переключение `Создать`/`Вход` не меняло геометрию окна.",
    ],
    fixed: [
      "Сохранённый ID больше не открывает отдельную quick-login карточку, которая меняла высоту auth-панели: ID остаётся в обычном редактируемом поле.",
      "Технические ошибки подключения в auth-окне заменяются короткой пользовательской подсказкой без `code=...`, gateway/WebSocket/BUILD_ID деталей.",
    ],
  },
  {
    version: "0.1.813",
    date: "2026-06-02",
    improved: [
      "Web/PWA теперь открывает авторизацию сразу в стабильном корпоративном окне: welcome-переход убран из обычного старта, блоки, кнопки, описания и размеры компактно распределены без внутренних прокруток.",
    ],
    fixed: [
      "После выхода больше не показывается отдельное мигающее logout-окно: клиент очищает сессию и возвращает пользователя прямо на экран авторизации.",
      "Fullscreen auth/welcome поверхности больше не используют pop/fade-анимации и бегущую полоску, которые визуально воспринимались как многократное мигание.",
    ],
  },
  {
    version: "0.1.812",
    date: "2026-06-02",
    improved: [
      "Экран входа и регистрации Web/PWA закреплён как единая корпоративная поверхность: общий заголовок, стабильная hero-зона и постоянный слот статуса не перестраивают макет при переключении.",
    ],
    fixed: [
      "При нажатии `Создать` или `Вход` форма больше не должна визуально прыгать из-за смены крупных текстов, появления уведомлений или изменения высоты карточки доступа.",
    ],
  },
  {
    version: "0.1.811",
    date: "2026-06-02",
    improved: [
      "Экран входа Web/PWA переработан под строгий корпоративный мессенджер: спокойная карточка доступа, служебные статусы и без декоративной потребительской графики.",
      "Первичный boot-экран стал статичным и стабильным, без анимаций, blur/scale-переходов и скачков шрифта перед открытием клиента.",
    ],
    fixed: [
      "PWA/Web больше не запускает boot recovery при обычном required update, поэтому URL вида `?__pwa_reset=...` не должен уходить в повторяющийся цикл восстановления и перезагрузки.",
      "Проверка PWA BUILD_ID теперь сравнивает live build с активным полным build hash клиента, а одноразовые параметры `__yg_update` и `__pwa_reset` очищаются после успешного boot.",
    ],
  },
  {
    version: "0.1.810",
    date: "2026-06-02",
    improved: [
      "Перед входом Web/PWA теперь выполняет обязательную проверку live BUILD_ID на сервере и блокирует дальнейший запуск, если опубликована новая версия.",
      "Update-gate применяет service worker update, сбрасывает зациклившийся старый кэш и перезапускает клиент до открытия профиля, чатов, истории и альбомов.",
      "Сравнение BUILD_ID учитывает известный активный build hash, а первый запуск текущей версии не уходит в лишний цикл обновления.",
    ],
    fixed: [
      "После выката новой версии устаревший клиент больше не должен доходить до экранов профиля/истории и залипать на ошибках загрузки страницы или альбома.",
    ],
  },
  {
    version: "0.1.809",
    date: "2026-06-01",
    improved: [
      "PWA/Web recovery теперь подключён к lazy-загрузке страниц, правой панели и deferred media: при stale hashed chunk клиент запускает контролируемый перезапуск вместо залипания на ошибке загрузки.",
      "Deferred album/voice surface показывает состояние обновления приложения, если ошибка альбома вызвана устаревшим chunk после выката новой версии.",
      "Флаг lazy-import recovery очищается после успешного boot, поэтому старый session-флаг больше не блокирует последующее восстановление после следующего обновления.",
    ],
    fixed: [
      "Профиль, страницы и альбомы в истории больше не должны оставаться в состоянии `Не удалось загрузить страницу/альбом` до ручного перезахода после обновления сайта/PWA.",
    ],
  },
  {
    version: "0.1.808",
    date: "2026-06-01",
    improved: [
      "Мобильная строка статуса стала отдельной status lane в шапке: важные runtime/file/history состояния теперь видны без всплывающих toast и озвучиваются через aria-live.",
      "Фото и видео в истории получили явные состояния прямо внутри media shell: загрузка с процентом, пустое превью, недоступный файл и действие загрузки теперь читаются заметнее.",
      "Кнопка перехода вниз показывает компактную подпись количества новых сообщений рядом с unread badge, чтобы после виртуализации длинной истории проще не потерять позицию.",
    ],
    fixed: [
      "Мобильная история с медиа и непрочитанными сообщениями должна давать больше контекста вместо пустых или слишком незаметных состояний при восстановлении чата.",
    ],
  },
  {
    version: "0.1.807",
    date: "2026-06-01",
    improved: [
      "Мобильная виртуализация истории теперь различает отсутствующую позицию окна и явный верхний scroll: при первом открытии длинного чата сразу рендерится хвост истории, а не старые сообщения сверху.",
      "Явная верхняя позиция `virtualStart=0` сохраняется после последующих history sync patches, поэтому ручной скролл к началу не сбрасывается обратно на хвост.",
    ],
    fixed: [
      "На мобильном Web/PWA/Android длинная история больше не должна мигать или визуально пропадать из-за стартового virtual window у начала списка после восстановления истории.",
    ],
  },
  {
    version: "0.1.806",
    date: "2026-06-01",
    improved: [
      "Видимые фото и видео из истории снова запрашивают серверное превью в silent-режиме: клиент подтягивает `thumb_url` для плейсхолдеров без ручного открытия вложения.",
      "Автодогрузка остаётся щадящей: Web/PWA гидратирует миниатюру, а полный медиафайл скачивает только по явному открытию или разрешённой cache policy.",
    ],
    fixed: [
      "Фото из истории у получателей больше не должны оставаться пустыми после перезахода, обновления PWA или восстановления чата из server history.",
    ],
  },
  {
    version: "0.1.805",
    date: "2026-06-01",
    improved: [
      "Медиа в чате стали надёжнее для DB-хранилища: сервер теперь генерирует постоянные preview для картинок и видео даже без локального file path.",
      "PWA/Web получают событие готовности превью после загрузки DB-backed вложения, поэтому новые фото и видео должны быстрее появляться в чате без ручного открытия.",
    ],
    fixed: [
      "Картинки и файлы в мессенджере больше не должны зависать у получателей в состоянии плейсхолдера после успешной отправки через DB-backed storage.",
    ],
  },
  {
    version: "0.1.804",
    date: "2026-05-15",
    improved: [
      "PWA/Web viewer больше не сбрасывает выбранный чат за overlay: история остаётся отрендеренной за просмотром фото/видео, поэтому закрытие viewer сохраняет позицию прокрутки.",
      "Скролл-события под fullscreen viewer/call overlay больше не меняют виртуальное окно истории и не переносят длинную историю к началу после просмотра медиа.",
    ],
    fixed: [
      "После просмотра фото/видео в чате прокрутка истории больше не должна улетать наверх.",
    ],
  },
  {
    version: "0.1.803",
    date: "2026-05-15",
    improved: [
      "PWA/Web chat history теперь показывает terminal `not_found` для фото/видео как `Файл недоступен`, без сырого `Ошибка файла: not_found` в статусе и карточке вложения.",
      "Viewer/open path больше не переотправляет `file_get` для image/video, у которых уже есть terminal missing transfer; cached preview остаётся плейсхолдером недоступного медиа.",
    ],
    fixed: [
      "Клик по отсутствующему фото/видео больше не ставит pending viewer/download и не запускает повторную загрузку несуществующего файла.",
    ],
  },
  {
    version: "0.1.802",
    date: "2026-05-14",
    improved: [
      "PWA/Web chat media теперь ведёт себя спокойнее: фото и видео в чате остаются click-to-load и не стартуют silent background `file_get` только из-за видимого placeholder.",
      "History media prefetch больше не запускает сетевую догрузку старых image/video строк; cached preview restore сохраняется, а отсутствующие вложения остаются стабильными плейсхолдерами.",
    ],
    fixed: [
      "Входящие фото/видео file_offer больше не auto-accept в активной PWA-вкладке, поэтому чат не начинает сам скачивать медиа без явного открытия пользователем.",
    ],
  },
  {
    version: "0.1.801",
    date: "2026-05-14",
    improved: [
      "История медиа стала спокойнее при старых вложениях: клиент запоминает terminal `not_found` для фоновой догрузки и больше не гоняет повторные preview-запросы к отсутствующим фото.",
      "Автопрогрев history_result и visible preview теперь уважают terminal error state fileTransfers, поэтому пустые media-shell остаются плейсхолдерами без повторной сетевой загрузки.",
    ],
    fixed: [
      "PWA/Web больше не должны снова и снова пытаться загрузить несуществующие картинки из истории после исчерпания `not_found` retry-window.",
    ],
  },
  {
    version: "0.1.799",
    date: "2026-05-13",
    improved: [
      "Release-контур синхронизирован для web/PWA, Android, macOS desktop и CLI downloads: новые сборки проходят один общий version/download manifest path.",
      "macOS desktop feed и ZIP пересобираются вместе с public downloads, чтобы desktop-клиент видел тот же актуальный релиз, что и сайт.",
      "Android debug APK обновлён отдельным versionCode/versionName, чтобы sideload-клиенты получали явный новый артефакт вместо повторного скачивания старой версии.",
    ],
    fixed: [
      "Публичный сайт, PWA service worker и downloads manifest больше не должны расходиться после пересборки всех клиентов в рамках одного релизного прохода.",
    ],
  },
  {
    version: "0.1.798",
    date: "2026-05-13",
    improved: [
      "History/runtime delivery контур стал единым: outbox, drafts, fileTransfers, retry policy и flush перед reload/install теперь проходят через общий delivery layer.",
      "После восстановления истории из IndexedDB клиент больше не запускает немедленный forced tail reload: серверная сверка идет через общий freshness budget, чтобы не провоцировать reload storms в PWA/iOS.",
      "Download runtime разгружен отдельным policy/type слоем, чтобы file download feature оставался ниже size-gate и не превращался обратно в монолит.",
    ],
    fixed: [
      "Partial-state render контракты истории снова безопасно трактуют отсутствующий page как main surface, не ломая реальные profile/files страницы.",
      "macOS desktop update install теперь сохраняет unified runtime delivery state перед перезапуском, а не разрозненные outbox/draft ветки.",
    ],
  },
  {
    version: "0.1.796",
    date: "2026-05-12",
    improved: [
      "PWA/Web/Desktop строже отделяют provisional history cache от подтверждённой сервером истории: пока tail-reconcile не пришёл, старые network media urls из локального кеша больше не считаются валидным preview/source state.",
      "Диагностика client_info стала чище: build_id теперь нормализуется по текущей версии приложения и не должен больше тянуть устаревший active build из localStorage после нового релиза.",
    ],
    fixed: [
      "Старые удалённые фото/видео из кешированной истории больше не должны успевать запустить auto-hydration и media preview incidents до прихода server reconcile.",
      "После нового релиза серверные логи больше не должны показывать ложную смесь вроде `version=0.1.796`, `build_id=0.1.794-*` для одного и того же PWA shell.",
    ],
  },
  {
    version: "0.1.795",
    date: "2026-05-12",
    improved: [
      "История чатов теперь жёстче отделяет локальный provisional cache от подтверждённой сервером истории: после восстановления из IndexedDB клиент сразу дожимает реальный tail-reconcile с сервера.",
      "Web/PWA/Desktop перестали доверять старым network transfer/thumb URLs из локального history cache, пока сервер не подтвердил текущий состав сообщений и вложений.",
      "Visible media hydration для старых фото/видео работает безопаснее: удалённые или уже мёртвые вложения не должны бесконечно оживать из локального кеша поверх новой серверной истории.",
    ],
    fixed: [
      "Удалённые сервером сообщения с вложениями теперь вычищаются из history_result через deleted_ids до merge в локальную историю, вместе с orphaned fileTransfers/thumb cache.",
      "Старые битые media rows после reconnect/reopen больше не должны повторно рендериться как будто они ещё существуют на сервере.",
    ],
  },
  {
    version: "0.1.794",
    date: "2026-05-12",
    improved: [
      "PWA/Web/Desktop: после media/history сбоев клиент теперь ставит stability-hold и не пытается автообновиться или перезагрузить shell в момент деградации истории.",
      "Скачивание файлов в web/PWA стало безопаснее для standalone shell: fallback больше не уводит текущее приложение в same-tab navigation, если браузер не смог открыть download через скрытую ссылку.",
      "Наблюдаемость media/history стала жёстче: client incidents теперь дополнительно отмечают локальное degraded-state окно, чтобы обновление и recovery-path не спорили с текущими ошибками вложений.",
    ],
    fixed: [
      "PWA больше не должен самопроизвольно сбрасываться в момент, когда старое фото/видео из истории не смогло нормально догрузиться или открыть preview.",
      "Ленивые media-chunk import failures во время активных history/media проблем больше не форсируют мгновенный reload поверх уже деградировавшего PWA shell.",
    ],
  },
  {
    version: "0.1.793",
    date: "2026-05-12",
    improved: [
      "PWA/Web: экран «Справка» теперь показывает актуальный текущий релиз, а не зависает на старой changelog-версии, если сам клиент уже обновился.",
      "macOS desktop: packaged-клиент теперь по умолчанию сам проверяет release feed после старта, поэтому новые desktop обновления не требуют скрытого env-флага для auto-check.",
      "Публикация packaged release стала строже: web/PWA shell, public downloads и macOS desktop feed должны ехать одним согласованным комплектом артефактов.",
    ],
    fixed: [
      "macOS auto-update больше не должен упираться в рассинхрон feed vs artifact: desktop feed и опубликованный ZIP выравниваются в один production contour.",
      "PWA/help больше не создаёт ложное ощущение, что клиент остался на `v0.1.776`, когда сам runtime уже обновился до более нового build.",
    ],
  },
  {
    version: "0.1.776",
    date: "2026-04-23",
    improved: [
      "Старт приложения стал дружелюбнее: первый экран теперь чище разделяет восстановление активной сессии, быстрый вход в сохранённый аккаунт и сценарий нового пользователя.",
      "Вход собран в один понятный entry-flow: статусы подключения, auto-resume и явные кнопки для ручного входа или смены аккаунта больше не размазаны по нескольким разрозненным модалкам.",
      "Стартовые экраны стали спокойнее визуально: меньше вторичных блоков, аккуратнее отступы и понятнее иерархия действий для входа и регистрации.",
    ],
    fixed: [
      "Сценарии `session_invalid` и `session_replaced` больше не выглядят как внезапный технический сбой: причина и следующий шаг показаны прямо в стартовом экране.",
    ],
  },
  {
    version: "0.1.753",
    date: "2026-03-13",
    improved: [
      "Чат стартует чуть легче: одиночные image/video preview теперь оставляют в основном bundle только лёгкий placeholder, а тяжёлый visual preview surface догружается отдельным фоновым чанком.",
      "Открытие истории на слабых устройствах стало спокойнее: обычный file-row first paint остаётся синхронным, а расширенный preview upgrade path для image/video подключается по требованию.",
      "Архитектура visual preview стала чище: single-message preview и album/deferred media теперь используют общий deferred preview surface, поэтому дальнейшая полировка media preview меньше раздувает eager `components`.",
    ],
    fixed: [
      "Остаточный single-message image/video preview path больше не держит лишний visual preview код в eager `components` bundle: синхронный shell отделён от полной preview surface.",
    ],
  },
  {
    version: "0.1.752",
    date: "2026-03-13",
    improved: [
      "Чат стартует ещё легче: редкие system/action/invite сообщения теперь уводят тяжёлый UI карточек и action-surface в отдельный фоновый чанк, не утяжеляя первый показ обычной текстовой истории.",
      "Invite/system ветки стали спокойнее для слабых устройств: базовый bubble с текстом и кнопками появляется синхронно, а расширенная invite-card поверхность догружается по требованию.",
      "Архитектура special message rendering стала чище: у sys/action сообщений появился отдельный deferred runtime/surface слой, поэтому дальнейшая полировка invite/system UI меньше раздувает основной chat bundle.",
    ],
    fixed: [
      "Редкие system/invite ветки в чате больше не держат лишний код внутри eager `components` bundle: обычный history path отделён от invite-card и action-heavy surface.",
    ],
  },
  {
    version: "0.1.751",
    date: "2026-03-13",
    improved: [
      "Чат стартует легче: voice/audio bubble и album-сообщения теперь догружают тяжёлый media UI по требованию, не утяжеляя первый показ обычной текстовой истории.",
      "Открытие диалога на медленных устройствах стало спокойнее: базовый рендер истории остаётся синхронным, а специальные media-surface ветки подключаются отдельным фоновым чанком.",
      "Архитектура media-рендера стала чище: у chat media появился отдельный deferred runtime/surface слой, поэтому дальнейшая полировка voice-player и album-grid меньше раздувает основной chat bundle.",
    ],
    fixed: [
      "Специальные media-ветки в чате больше не тянут лишний код в eager `components` bundle: обычные текстовые сообщения и основной history path отделены от album/voice surface.",
    ],
  },
  {
    version: "0.1.750",
    date: "2026-03-06",
    improved: [
      "История сообщений: album bubble теперь собирается через отдельный surface, поэтому media grid и нижний footer с `caption + meta` читаются как одна связная зона, а не как случайно сложенные блоки.",
      "Media albums стали ближе к Telegram-подобной композиции: клиент теперь прокидывает реальную ширину мозаики в shell, из-за чего подпись и мета выравниваются по фактической геометрии album, а не по слишком широкому bubble.",
      "Код album layout стал более пригодным для дальнейшей полировки: tile-ноды теперь получают явные edge-атрибуты top/right/bottom/left, а отдельный CSS-part отвечает только за mosaic-shell, не раздувая старый media-монолит.",
    ],
    fixed: [
      "Mixed-size media groups в истории больше не должны выглядеть как случайная нарезка с оторванным footer: album shell, footer width и outer-edge geometry теперь собраны в один предсказуемый layout-контракт.",
    ],
  },
  {
    version: "0.1.749",
    date: "2026-03-06",
    improved: [
      "Чатовые service surfaces стали спокойнее на mobile: pinned bar получил более компактный shell с явным pin-marker, cleaner preview и встроенной навигацией по нескольким закрепам.",
      "Jump-to-bottom и composer permission badges стали менее шумными: floating jump-chip собран плотнее, а denied-indicators у voice/video кнопок уменьшены и лучше вписаны в нижний composer.",
      "Center warn/error toasts больше не висят по центру истории на телефоне: mobile surface теперь прижимает их ближе к нижней safe-area над композером, чтобы не ломать чтение чата.",
    ],
    fixed: [
      "Pinned/warning/jump surfaces в чате больше не должны выглядеть как набор несогласованных элементов: верхний закреп, нижний jump и mobile warning-toasts собраны в более цельную, менее шумную систему.",
    ],
  },
  {
    version: "0.1.748",
    date: "2026-03-06",
    improved: [
      "История сообщений: у обычных текстовых сообщений появился явный content-shell для связки `text + meta`, поэтому bubble теперь читается как одна структурная зона, а не как набор разрозненных узлов.",
      "Message meta в обычных bubble-сообщениях стало более собранным: время, edited и статус теперь живут в компактном footer-chip, который лучше отделяет нижний ритм сообщения от основного текста.",
      "Код истории стал чище: shell для текстового содержимого вынесен в отдельный helper, а новые правила bubble/meta вынесены в отдельный CSS-part вместо наращивания старых монолитных файлов.",
    ],
    fixed: ["Текстовые bubble-сообщения в истории больше не должны выглядеть как «плавающий текст» с отдельно висящим временем: text и meta теперь рендерятся как единый структурный блок."],
  },
  {
    version: "0.1.747",
    date: "2026-03-06",
    improved: [
      "Viewer на mobile/iOS: верхний overlay-header получил более безопасный верхний отступ и более явный top-gradient, поэтому metadata и кнопки больше не липнут к status bar iPhone.",
      "Mobile viewer: длинные file/author строки в topbar теперь ужимаются и обрезаются предсказуемо, вместо того чтобы расползаться и ломать верхнюю зону экрана.",
      "Верхняя панель viewer стала чище на узких экранах: actions остаются выровненными сверху, а metadata-текст больше не спорит с ними за место.",
    ],
    fixed: ["iPhone viewer header больше не должен конфликтовать со status bar и длинным metadata-текстом, как это было видно на последних screenshot-проверках."],
  },
  {
    version: "0.1.746",
    date: "2026-03-06",
    improved: [
      "Mobile/iOS чат: между историей и overlay-композером появился отдельный bottom breathing room, поэтому последний блок сообщений читается чище и не липнет к нижней панели.",
      "Jump-to-bottom на телефоне теперь использует тот же нижний gap-контракт, что и история, поэтому floating-кнопка выровнена с новым ритмом нижней зоны чата и не выглядит случайно подвешенной.",
      "При открытой экранной клавиатуре mobile layout автоматически ужимает этот нижний gap, чтобы не терять вертикальное место и сохранить более плотный runtime-ритм при наборе текста.",
    ],
    fixed: ["Нижняя граница истории на mobile/iOS больше не выглядит слишком жёсткой: между последними сообщениями и композером появился управляемый зазор, который не превращается в лишнюю пустоту при открытой клавиатуре."],
  },
  {
    version: "0.1.745",
    date: "2026-03-06",
    improved: [
      "iOS chat composer: нижний shell композера стал ближе к настоящему edge-to-edge, поэтому bar визуально сильнее прижат к нижнему краю iPhone, а не выглядит подвешенным над ним.",
      "Mobile/iOS: для composer введён отдельный bottom-edge pad override, который опускает chat input ниже, но всё ещё держит controls в безопасной зоне над home indicator.",
      "Чатовый низ стал визуально цельнее: blur/solid bar и safe-area слой теперь дают более плотное, Telegram-подобное ощущение у нижнего края экрана.",
    ],
    fixed: ["iOS chat bottom больше не выглядит как бар с лишним запасом снизу: composer опущен ближе к реальному краю телефона без возврата старых keyboard-gap регрессий."],
  },
  {
    version: "0.1.744",
    date: "2026-03-06",
    improved: [
      "Viewer: нижняя часть media overlay теперь собрана в явный footer shell, где caption, media counter и rail живут как одна структурная зона вместо разрозненных absolute-элементов.",
      "Viewer: в visual media groups появился контекст позиции `Фото/Видео N из M`, поэтому внутри album и соседних media strip стало яснее, где находится текущее вложение.",
      "Архитектура viewer стала чище: rail/caption вынесены в отдельный helper, а расчёт нижнего UI теперь опирается на один footer container, а не на ad-hoc сумму высот разных узлов.",
    ],
    fixed: ["Viewer footer больше не держится на разрознённых caption/rail overlay-блоках: hover/zoom и bottom-ui measurement теперь работают по единому shell-контейнеру и стабильнее ведут себя при дальнейших правках."],
  },
  {
    version: "0.1.743",
    date: "2026-03-06",
    improved: [
      "История сообщений: у image/video и album появился единый media overlay controls shell, который одинаково держит selection и action controls поверх media bubble.",
      "История сообщений: placement selection больше не зависит от разрозненных CSS-правил в разных partial-файлах — логика вынесена в явный DOM-shell и отдельные helper-модули.",
      "Desktop/mobile media interactions стали стабильнее: overlay controls теперь структурно одинаковы у image/video/album, а inline file/audio ветки сохранили свою отдельную схему без смешения.",
    ],
    fixed: ["Selection и action controls для media shell больше не расходятся между image/video и album flow: кнопки рендерятся через общий overlay surface, а regressions на старых file-row сценариях прикрыты прямыми тестами."],
  },
  {
    version: "0.1.742",
    date: "2026-03-06",
    improved: [
      "История сообщений: у media/file/album bubble появился явный attachment footer shell, поэтому caption и meta теперь читаются как отдельный структурный блок, а не как случайные соседние элементы.",
      "История сообщений: image/video c подписью и album-сообщения используют одинаковый stacked footer rhythm для caption + time/status, ближе к системной структуре клиента.",
      "История сообщений: audio/file attachments без подписи тоже получили предсказуемый meta-only footer, а overlay-meta оставлен только для действительно fullscreen-like visual media без caption.",
    ],
    fixed: ["Границы media bubble стали последовательнее: caption/meta больше не смешиваются с содержимым файла ad-hoc, а album/file/audio flows больше не расходятся по DOM-структуре."],
  },
  {
    version: "0.1.741",
    date: "2026-03-06",
    improved: [
      "История сообщений: date и unread separators получили явный shell с линиями и pill-структурой, поэтому границы ленты читаются заметно стабильнее.",
      "История сообщений: meta-строка сообщения теперь собирается из единых compact items для времени, пометки редактирования и статуса доставки.",
      "Визуальный ритм истории стал ближе к системному: separators и status/meta больше не выглядят как ad-hoc spacing между bubble-блоками.",
    ],
    fixed: ["Unread divider больше не растягивается случайной полосой на всю ширину экрана, а edited/status metadata читаются компактнее и предсказуемее в обычных и media bubble."],
  },
  {
    version: "0.1.740",
    date: "2026-03-06",
    improved: [
      "Отложенная отправка: modal больше не теряет выбранную дату/время при validation/re-render; поле сохраняет введённое значение и фокус остаётся стабильным.",
      "Modal flows: `forward` и `send_schedule` получили более явную dialog-semantics и выровненную action-row, ближе к общей системе модалок клиента.",
      "Full-screen состояния: `welcome` и `logout` теперь имеют явные screen-shell semantics; logout надёжнее ведёт себя с клавиатурой, а welcome корректнее объявляет себя как status-состояние.",
    ],
    fixed: ["`send_schedule` больше не сбрасывает выбранное время после ошибки валидации; `Escape` теперь последовательно закрывает schedule/logout flows, а cancel-кнопки у modal flows выровнены по вторичному стилю."],
  },
  {
    version: "0.1.739",
    date: "2026-03-06",
    improved: [
      "Меню: coarse-pointer context menu теперь рендерится как более явный sheet с header и кнопкой закрытия, а не как просто список действий под handle.",
      "Меню/модалки: context menu sheet получил корректную семантику `dialog`, а popup-вариант сохранил `menu`, чтобы поверхности вели себя системнее.",
      "Подтверждения: confirm modal теперь оформлен как отдельный shell с tone и более явной action-row, ближе к продуктовым модалкам клиента.",
    ],
    fixed: ["Confirm modal теперь стабильно закрывается по `Escape`, а cancel-кнопка использует вторичный стиль; sheet/menu и confirm surfaces визуально и поведенчески стали ближе друг к другу."],
  },
  {
    version: "0.1.738",
    date: "2026-03-06",
    improved: [
      "История сообщений: у bubble-групп появились явные роли `single / start / middle / end`, чтобы структура истории была стабильнее и предсказуемее для дальнейшего UI-polish.",
      "История сообщений: grouped bubbles внутри одного блока теперь стекаются плотнее, а разрыв между независимыми сообщениями читается лучше.",
      "Архитектура истории: renderChat больше не навешивает group-геометрию ad-hoc — это вынесено в отдельный helper с прямыми тестами.",
    ],
    fixed: ["Группы сообщений визуально меньше разваливаются на одинаково отстоящие строки: continuation-сообщения и альбомы теперь читаются как цельный блок."],
  },
  {
    version: "0.1.737",
    date: "2026-03-06",
    improved: [
      "Меню/модалки: добавили явную modal surface model для слоёв inline / overlay-context / overlay-viewer / overlay-auth вместо размазанной логики прямо в renderApp.",
      "Backdrop lifecycle: правила закрытия по overlay для context menu и file viewer теперь определяются в одном helper и покрыты прямыми unit-тестами.",
      "Архитектура: renderApp стал тоньше по platform-слою — применение overlay classes и surface routing вынесены в отдельный модуль.",
    ],
    fixed: ["File viewer: защита от случайного backdrop-close сразу после открытия теперь живёт в общем overlay policy, а не в локальном обработчике с дублирующей логикой."],
  },
  {
    version: "0.1.736",
    date: "2026-03-06",
    improved: [
      "История сообщений: вынесли явную history layout model для рендера границ date/unread/message/album вместо расчёта всего прямо внутри renderChat.",
      "История сообщений: virtual slice теперь сохраняет continuation boundary между сообщениями, даже когда рендерится только окно истории.",
      "Непрочитанные: divider больше не привязывается к системным сообщениям после lastRead и смещается к первому реальному сообщению.",
    ],
    fixed: ["Внутренняя структура истории стала предсказуемее: album groups, separators и хвосты групп теперь считаются как отдельные blocks и покрыты прямыми тестами."],
  },
  {
    version: "0.1.735",
    date: "2026-03-05",
    improved: [
      "iOS/mobile: история чата теперь скроллится «под» строкой ввода (композер overlay, tweb‑like) — последние сообщения не прячутся (авто‑inset по высоте композера/футера поиска).",
      "iOS standalone/fullscreen: уменьшили визуальный «подвал» внизу (safe‑area фон ближе к композеру; clamp для app gap).",
      "Старт: splash‑логотип на загрузке + мягкий fade‑out переход к регистрации/приложению.",
      "Выход: обновили экран logout (логотип + более продуктовый текст) и добавили плавное появление full‑screen модалок.",
    ],
  },
  {
    version: "0.1.734",
    date: "2026-03-05",
    improved: [
      "Профили чатов/досок: добавили блоки «Роли и доступ», «Инвайт‑ссылка», «Заявки на вступление» (для владельца) и «Общие медиа».",
      "Профили чатов/досок: быстрый переход в «Файлы» из профиля.",
      "Уведомления: всплывающие предупреждения (toast) больше не мерцают при фоновых перерендерах; стиль стал компактнее и более квадратным.",
    ],
  },
  {
    version: "0.1.733",
    date: "2026-03-05",
    improved: [
      "Голосовые: запись стала ближе к Telegram Web — удержание для записи, свайп влево для отмены, вверх для «замка» (lock); отправка без модалки подтверждения.",
      "Голосовые: добавили переключение скорости 1x/1.5x/2x (с запоминанием) и single-player — при старте нового аудио предыдущее ставится на паузу.",
      "Голосовые: кнопка Play теперь догружает файл, если он ещё не в кеше (inline file-get), и пытается начать воспроизведение сразу после загрузки.",
    ],
  },
  {
    version: "0.1.732",
    date: "2026-03-04",
    fixed: ["Пересылка: пункт «Переслать» в меню сообщения снова открывает окно выбора получателей (forward modal)."],
  },
  {
    version: "0.1.731",
    date: "2026-03-04",
    improved: [
      "Пересылка: пикер получателей стал ближе к Telegram Web — единый список с сортировкой как в сайдбаре (закрепы/недавние).",
      "Пересылка: добавили удобную клавиатуру в пикере (↑/↓, Enter/Space, Esc, Cmd/Ctrl+Enter) и подсветку активной строки.",
      "Пересылка: server-search по @handle/ID в окне пересылки (секция «В сети») — можно быстро найти получателя не в контактах.",
    ],
    fixed: ["Пересылка: выбор получателей больше не сбрасывается при фоновых обновлениях UI (стабильный mount модалки)."],
  },
  {
    version: "0.1.729",
    date: "2026-03-04",
    improved: [
      "Закрепы: список закреплённых стал информативнее — показываем превью, автора и время (telegram‑like).",
      "Пересылка: окно выбора получателей — добавили «Недавние» и чипсы выбранных получателей для более быстрого multi‑select.",
      "Меню/модалки: контекстное меню поддерживает двухстрочные пункты (label + meta) — лучше читаются списки (например, закрепы).",
    ],
    fixed: [
      "Закрепы: переход к закреплённому сообщению теперь сам догружает историю, если сообщение ещё не было в кеше (bounded backfill).",
      "Закрепы: jump работает стабильнее при виртуализации истории (сообщение подставляется в окно рендера перед скроллом).",
      "Меню сообщений: «Цитировать» больше не дублирует «Ответить» — доступно только при выделении текста и вставляет цитату в композер.",
    ],
  },
  {
    version: "0.1.728",
    date: "2026-03-04",
    improved: [
      "Пересылка: окно выбора получателей стало ближе к Telegram — показываем аватары и добавили поле комментария (отправляется отдельным сообщением перед пересланными).",
      "Закрепы: добавили список закреплённых сообщений и действие «Открепить все» (как в Telegram).",
      "Меню сообщений: упорядочили пункты и сделали его компактнее; pin/unpin теперь с confirm‑модалкой.",
    ],
    fixed: [
      "Закрепы: крестик в закрепе теперь скрывает панель (Hide pinned messages) вместо немедленного открепления.",
      "Выбор сообщений: pin‑кнопка теперь доступна только при выборе одного сообщения (telegram‑like).",
    ],
  },
  {
    version: "0.1.727",
    date: "2026-03-04",
    fixed: [
      "Файлы: повторное «Скачать» больше не пытается запускать PWA-stream поверх уже активной загрузки (дедуп по fileId).",
      "Файлы: загрузки корректно прерываются при выходе из аккаунта (AbortController).",
    ],
    improved: [
      "Файлы: HTTP‑скачивание теперь идёт через очередь с лимитами и приоритетами (UI > prefetch) — меньше параллельных загрузок и стабильнее сеть/память.",
      "Файлы: фоновые prefetch-загрузки выполняются только в leader‑табе (меньше дублей и лишних запросов между вкладками).",
      "Кэш: очистка CacheStorage теперь запускается только по необходимости (TTL/перелимит) и коалесцируется — меньше лишней работы в фоне.",
    ],
  },
  {
    version: "0.1.726",
    date: "2026-03-03",
    fixed: [
      "Авторизация: убран зелёный «листик» на логотипе.",
      "Авторизация (macOS PWA): поля пароля стали стабильнее для ввода (отключены «ассистенты»/fancy caret).",
    ],
    improved: [
      "Авторизация: экран входа стал дружелюбнее — обновили шапку, типографику и отступы; маленький логотип теперь совпадает с актуальным SVG.",
      "Авторизация: бейдж логотипа стал нейтральным (без розовой подложки).",
      "История: загрузка и догрузка сообщений стала «cache‑first» — сначала восстанавливаем хвост/страницы из IndexedDB, и только потом обращаемся к сети (меньше нагрузки на сервер, быстрее после перезапуска).",
      "История: добавили мягкий фоновый delta‑sync для диалогов — периодически перепроверяем новые/изменённые сообщения без открытия чата (tweb‑like).",
      "История: добавили лимит кэша (IndexedDB) на чат + авто‑очистку старых сообщений — кэш не растёт бесконечно, а backfill не выкачивает «бесконечную» историю.",
      "Файлы: добавили управление кэшем истории — выбор лимита и кнопка «Очистить кэш истории».",
      "PWA: обновление иконок стало надёжнее (cache-bust для manifest и icon assets).",
      "PWA: иконка теперь без белой подложки (прозрачный фон).",
      "PWA/macOS: добавили отдельные app-иконки с тёмным фоном, чтобы не было розовой подложки/квадрата в Dock.",
      "Сайдбар: убраны фильтры списка чатов (Все/Непрочитанные/Упоминания/Личные/Группы).",
    ],
  },
  {
    version: "0.1.723",
    date: "2026-02-17",
    fixed: [
      "Mobile/iOS: догрузка истории стала стабильнее — устранено «залипание» при прокрутке к старым сообщениям.",
      "Mobile/iOS: загрузка превью/медиа стала устойчивее при проблемах HTTP (автоматический fallback на резервный канал).",
    ],
    improved: ["Диагностика: расширены события в DBG для точного разбора проблем с медиа."],
  },
  {
    version: "0.1.722",
    date: "2026-02-14",
    fixed: [
      "Mobile/iOS: видимые превью медиа (image/video) теперь всегда инициируют file_get (даже без prefetch/Save-Data) — превью не остаются пустыми.",
      "Mobile/iOS: chatHost touch-tracking не перехватывает жест, если touchstart был на кнопке/ссылке; микродвижение не отменяет tap по превью.",
    ],
  },
  {
    version: "0.1.721",
    date: "2026-02-13",
    fixed: [
      "Mobile: изображения в viewer восстанавливаются при ошибке загрузки (refresh URL → fallback скачивание).",
      "Mobile: загрузка thumb использует cache: no-store (устранение проблем кэша на iOS).",
    ],
  },
  {
    version: "0.1.720",
    date: "2026-02-13",
    fixed: ["Mobile: по тапу на превью фото теперь стабильно открывается viewer."],
  },
  {
    version: "0.1.712",
    date: "2026-02-09",
    improved: [
      "Звонки: главное окно Jitsi для исходящего аудио/видео открывается сразу после создания комнаты (без ожидания принятия).",
      "Звонки: единое поведение отображения call-screen на desktop/mobile в исходящем сценарии.",
    ],
  },
  {
    version: "0.1.711",
    date: "2026-02-09",
    improved: ["Звонки: окно ошибок (toast) стало компактнее."],
  },
  {
    version: "0.1.704",
    date: "2026-02-04",
    fixed: ["Viewer: для portrait фото центрирование по высоте стабилизировано (учёт нижних оверлеев применяется к .viewer-media, меньше браузерных расхождений)."],
  },
  {
    version: "0.1.703",
    date: "2026-02-04",
    fixed: [
      "Viewer (браузер): высота медиа считается от --app-vh (без 100vh/адрес-бара), портретные фото/видео больше не «проваливаются вниз».",
      "Видео: в viewer используем poster из thumb и пытаемся автозапускать по клику; если inline-play в истории не удаётся — открываем viewer.",
    ],
  },
  {
    version: "0.1.702",
    date: "2026-02-02",
    fixed: ["Viewer (desktop PWA): портретные фото/видео больше не «проваливаются вниз» из‑за нижней ленты/подписи — центрируем медиа с учётом оверлеев."],
  },
  {
    version: "0.1.701",
    date: "2026-02-02",
    fixed: ["Viewer: медиа больше не выглядит «примагниченным к низу» — шапка всегда overlay, центрирование по высоте стабильно."],
  },
  {
    version: "0.1.700",
    date: "2026-02-02",
    fixed: ["Viewer (desktop PWA): портретные фото/видео теперь центрируются по высоте (шапка поверх, без смещения вниз)."],
  },
  {
    version: "0.1.699",
    date: "2026-02-02",
    fixed: ["Видео: превью появляется сразу после отправки и обновляется без перезахода (локальный poster + быстрый опрос thumb для видимых сообщений)."],
  },
  {
    version: "0.1.698",
    date: "2026-02-02",
    fixed: ["Viewer: видео больше не «сжимает» окно из‑за стилей (ограничение 80% применяется только к самому медиа, шапка не съезжает)."],
  },
  {
    version: "0.1.697",
    date: "2026-02-02",
    fixed: ["Mobile: viewer шапка (имя/хэндл/дата) теперь не ломает лейаут — одна строка с ellipsis, медиа не «съезжает»."],
  },
  {
    version: "0.1.696",
    date: "2026-01-30",
    fixed: ["Viewer: фото/видео открываются по центру и занимают не больше ~80% экрана (≈20% поля вокруг — удобнее смотреть и перематывать)."],
  },
  {
    version: "0.1.695",
    date: "2026-01-30",
    fixed: ["История: превью медиа стабильно 33% даже если thumb_w/thumb_h не пришли (авто‑определяем размеры thumb при загрузке + fallback)."],
  },
  {
    version: "0.1.694",
    date: "2026-01-30",
    fixed: ["История: масштаб превью медиа снова 33% даже после перезапуска/кеша (восстановление thumb теперь сохраняет размеры)."],
  },
  {
    version: "0.1.693",
    date: "2026-01-30",
    fixed: ["Viewer: фото/видео открываются по центру без апскейла/растяжения (без эффекта «1000%»)."],
  },
  {
    version: "0.1.692",
    date: "2026-01-30",
    fixed: ["UI: на больших экранах шапка/поиск/композер теперь выровнены по центру контейнера сообщений (full-screen/resize без «уезда» влево)."],
  },
  {
    version: "0.1.691",
    date: "2026-01-30",
    improved: [
      "Медиа: превью фото/видео в истории уменьшено (≈33% от исходного превью) — лента компактнее, меньше визуальных скачков.",
      "Фото: в истории теперь предпочитаем thumb (полный файл открывается по клику).",
    ],
  },
  {
    version: "0.1.690",
    date: "2026-01-30",
    fixed: [
      "Медиа: видео с iOS-именами вида IMG_XXXX.MP4/MOV больше не определяется как «Фото» (превью и воспроизведение работают корректно).",
      "Файлы: при отправке всегда передаём mime (fallback по имени), чтобы /files/<fid> отдавал корректный Content-Type (важно при nosniff).",
    ],
  },
  {
    version: "0.1.682",
    date: "2026-01-27",
    improved: ["Reply/Forward: сервер теперь сохраняет refs и отдаёт их в истории (DM/группы; MVP: внутри текущего чата)."],
  },
  {
    version: "0.1.681",
    date: "2026-01-27",
    fixed: [
      "Медиа: превью фото/видео в истории теперь cache-first (восстанавливается из кеша после перезагрузки)",
      "Медиа: если сервер не отдаёт thumb — тихо подкачиваем и кэшируем медиа до 24MB (без «Фото/Видео» плейсхолдера)",
    ],
  },
  {
    version: "0.1.679",
    date: "2026-01-27",
    improved: ["Чатлист: папки как в Telegram (server-synced): вкладки, create/rename/delete, добавить/убрать чат через контекст-меню"],
  },
  {
    version: "0.1.678",
    date: "2026-01-27",
    improved: ["Чатлист: pinned порядок стабилен и сортировка по last_ts корректная во всех режимах (mobile/PWA/desktop)"],
  },
  {
    version: "0.1.677",
    date: "2026-01-27",
    improved: ["История: stable unread divider + read markers + «вниз» прыгает к unread, иначе к самому низу"],
  },
  {
    version: "0.1.676",
    date: "2026-01-27",
    improved: ["История: убрана кнопка «Загрузить ещё» — подгрузка сообщений происходит при скролле вверх, с аккуратным loader"],
  },
  {
    version: "0.1.670",
    date: "2026-01-26",
    improved: ["Сайдбар: «Архив (N)» теперь открывает архив сразу (сверху) и прокручивает список к началу"],
  },
  {
    version: "0.1.669",
    date: "2026-01-26",
    improved: [
      "Медиа: альбомы в истории теперь поддерживают фото+видео (grid) с бейджем ▶ на видео",
      "Viewer: rail для альбомов показывает весь набор медиа (tweb-like)",
      "Медиа: компактный вид для sticker (webp) и «круглых» видео (heuristic)",
    ],
  },
  {
    version: "0.1.668",
    date: "2026-01-26",
    improved: ["Чатлист: добавлен архив (В архив/Убрать из архива) с кнопкой «Архив» в поиске; хранится локально на устройстве"],
  },
  {
    version: "0.1.667",
    date: "2026-01-26",
    improved: ["Реакции: тексты/подсказки уточнены под модель «1 реакция на пользователя» (поставить/заменить/убрать)"],
  },
  {
    version: "0.1.666",
    date: "2026-01-26",
    improved: ["Медиа: viewer открывает файлы cache-first и иначе по http-ссылке (stream), без ожидания полного скачивания"],
    fixed: ["Медиа: корректный mime для viewer и скачиваний (используем mime из transfer/file_url + расширенный fallback по имени)"],
  },
  {
    version: "0.1.665",
    date: "2026-01-26",
    improved: ["Viewer: добавлена лента медиа (rail) и индикатор загрузки (preloader)"],
  },
  {
    version: "0.1.664",
    date: "2026-01-26",
    improved: ["Viewer: добавлены действия «Поделиться/Переслать/Удалить», а также pinch-zoom/pan на сенсорных устройствах"],
  },
  {
    version: "0.1.663",
    date: "2026-01-26",
    improved: ["Viewer: улучшены масштабирование и панорамирование изображений (zoom/pan)"],
  },
  {
    version: "0.1.662",
    date: "2026-01-26",
    improved: ["Файлы: добавлены настройки «Автоскачивание» (лимиты для фото/видео/файлов, хранится локально на устройстве)"],
  },
  {
    version: "0.1.661",
    date: "2026-01-26",
    improved: [
      "Медиа: авто‑скачивание файлов в истории теперь с tweb-like лимитами (фото 1MB, видео 15MB, файлы 3MB) — без «тихого» скачивания больших файлов",
    ],
  },
  {
    version: "0.1.660",
    date: "2026-01-26",
    improved: ["Поиск: в режиме выбора «Сервер» добавлена кнопка «Закрепить/Открепить» для выбранных чатов"],
  },
  {
    version: "0.1.659",
    date: "2026-01-26",
    improved: ["Шапка чата: добавлено меню ⋮ (topbar) для действий по чату", "Меню чата: добавлен пункт «Выбрать сообщения»"],
  },
  {
    version: "0.1.658",
    date: "2026-01-26",
    improved: ["Контакты: добавлен блок «Топ» (частые контакты; server top_peers)"],
  },
  {
    version: "0.1.657",
    date: "2026-01-23",
    improved: ["Лейаут (desktop): правая панель (info) в узком окне теперь открывается как оверлей и не «сжимает» чат"],
  },
  {
    version: "0.1.656",
    date: "2026-01-23",
    improved: ["Очистка истории: владелец чата/доски может очистить историю для всех (room_clear)"],
  },
  {
    version: "0.1.655",
    date: "2026-01-23",
    improved: [
      "Реакции: добавлена кнопка «＋» рядом с реакциями (bubble UI) — выбор любой реакции",
      "Реакции: добавлено окно «Реакции…» со списком всех реакций (tweb‑like)",
    ],
  },
  {
    version: "0.1.654",
    date: "2026-01-23",
    improved: [
      "Reply: добавлено меню в helper bar — «показать сообщение», «цитировать», «не отвечать» (tweb‑like)",
      "Forward: в окне выбора получателей добавлены опции «показывать отправителя/подпись»",
    ],
  },
  {
    version: "0.1.653",
    date: "2026-01-23",
    improved: ["Отправка: подготовлен переиспользуемый flow для send‑menu/попапов (draft + preserveComposer) — без изменения поведения"],
  },
  {
    version: "0.1.652",
    date: "2026-01-23",
    improved: [
      "Запланированная отправка: окно планирования теперь поддерживает до 365 дней вперёд (tweb‑like)",
      "Запланированная отправка: в личном чате (когда контакт offline) доступна кнопка «Когда будет онлайн» прямо в окне планирования",
      "Saved/self: планирование отображается как «Напоминание» (если чат с самим собой используется как Saved)",
    ],
  },
  {
    version: "0.1.651",
    date: "2026-01-23",
    improved: [
      "Отправка: send‑menu на кнопке отправки — «без звука», «запланировать», «когда будет онлайн» (tweb‑like)",
      "Отправка: удержание ЛКМ (desktop) открывает send‑menu (как long‑press)",
      "Отправка: кнопка отправки подсвечивается, пока меню открыто",
    ],
  },
  {
    version: "0.1.650",
    date: "2026-01-23",
    improved: [
      "Выбор сообщений: чекбоксы для фото/видео теперь отображаются поверх превью (внутри медиа-блока)",
      "Выбор сообщений: альбом — чекбокс внутри альбома (в правом верхнем углу) + tweb-like визуальное выделение (scale/overlay)",
      "Выбор сообщений: документы/аудио получают более заметное выделение в режиме выбора (scale/overlay)",
    ],
  },
  {
    version: "0.1.649",
    date: "2026-01-23",
    improved: [
      "Выбор сообщений: панель выбора теперь отображается поверх композера (как в tweb) — композер скрывается в режиме выбора",
      "Выбор сообщений: действия сгруппированы справа (контейнеры left/right)",
    ],
  },
  {
    version: "0.1.648",
    date: "2026-01-23",
    improved: [
      "Выбор сообщений: альбом (2+ фото) выбирается как группа (выбираются все элементы)",
      "Выбор сообщений: чекбоксы для документов/аудио размещены внутри блока вложения (без ломания лейаута)",
      "Выбор сообщений: для исходящих сообщений чекбокс справа от пузыря",
      "Выбор: запрещено выбирать action/service и сообщения со статусом sending/queued/error",
    ],
  },
  {
    version: "0.1.647",
    date: "2026-01-23",
    improved: [
      "Выбор сообщений: добавлены чекбоксы в истории (selection mode)",
      "Выбор сообщений: Shift+Click выбирает диапазон, drag по чекбоксам — массовый выбор/снятие",
      "Выбор: клики по ссылкам/кнопкам/аудио/видео не ломаются в режиме выбора",
    ],
  },
  {
    version: "0.1.646",
    date: "2026-01-23",
    improved: [
      "Контекст‑меню сообщений: если выделен текст внутри сообщения — доступны «Скопировать/Цитировать/Искать выделенное»",
      "Запланированные сообщения (очередь): добавлены действия «Отправить сейчас» и «Изменить время…»",
      "Выбор сообщений: добавлены действия «Скопировать», «Скачать» (для файлов) и «Отправить сейчас» (для запланированных)",
    ],
  },
  {
    version: "0.1.645",
    date: "2026-01-23",
    improved: [
      "Сообщения: контекст‑меню стало ближе к tweb — добавлены «Цитировать», «Скачать», «Скопировать ссылку», «Перевести» и «Ответы» (если есть)",
    ],
  },
  {
    version: "0.1.644",
    date: "2026-01-23",
    improved: [
      "Чатлист: сортировка стала tweb/Telegram-like — pin → по времени последнего сообщения (без лишних «прыжков» от unread/draft)",
      "Контакты: подпись online/last-seen обновляется автоматически (cadence ~30s)",
    ],
  },
  {
    version: "0.1.643",
    date: "2026-01-23",
    improved: [
      "Чатлист: tweb parity — menu-open фон выровнен с hover (filled-secondary), subtitle на desktop = 12px",
      "Чатлист: на мобильных активная строка не инвертирует цвета (как в Telegram)",
      "Сообщения: max-width bubble на handhelds выровнен под tweb (calc(100% - 89px))",
    ],
  },
  {
    version: "0.1.642",
    date: "2026-01-23",
    improved: ["Info: «История изменений» обновлена — добавлены последние релизы 0.1.638–0.1.641"],
  },
  {
    version: "0.1.641",
    date: "2026-01-23",
    improved: ["Авторизация: экран входа стал full-page (tweb-like) — верстка через `#auth-pages`, без «маленькой модалки»"],
    notes: ["Авторизация: размеры/брейкпоинты выровнены под tweb (max-width 720, высоты 810/760, брейк 721)"],
  },
  {
    version: "0.1.640",
    date: "2026-01-22",
    improved: ["Сайдбар: фильтры чатов доступны на desktop browser и PWA standalone (не только mobile)"],
    notes: ["Сайдбар: добавлены фильтры «Личные» и «Группы»"],
  },
  {
    version: "0.1.639",
    date: "2026-01-22",
    improved: ["Реакции: в контекстном меню сообщений добавлен выбор «другая реакция» (через emoji-popover)"],
    notes: ["Tweb parity: закрыт список pending UI-пунктов; device/PWA проверки можно выполнить позже"],
  },
  {
    version: "0.1.638",
    date: "2026-01-22",
    improved: ["Аватары: загрузка/редактирование обновляет аватар в UI сразу (sidebar/chat) — без перезагрузки страницы"],
  },
  {
    version: "0.1.637",
    date: "2026-01-21",
    fixed: [
      "Сообщения: статус «прочитано» больше не понижается обратно в «доставлено» при поздних ACK",
      "Синхронизация: unread_counts обновляется на всех устройствах/вкладках пользователя",
    ],
    improved: [
      "Статусы DM: добавлен этап «отправлено» (✓) и receipt delivered_to_device (✓✓)",
      "Файлы: входящие file_offer авто‑принимаются в активной вкладке (и в лидере, если все вкладки в фоне) — без «залипания»",
    ],
    notes: ["Тех.: новый тип события message_delivered_to_device (best‑effort, без лома старых клиентов)"],
  },
  {
    version: "0.1.636",
    date: "2026-01-21",
    improved: [
      "Уведомления: single-notifier между вкладками (Web Locks + BroadcastChannel) — без дублей тостов/звуков/Notification",
      "Тех.: client_info отправляет instance_id (на вкладку) и build_id; сервер логирует их для диагностики",
    ],
  },
  {
    version: "0.1.635",
    date: "2026-01-21",
    fixed: [
      "Файлы: входящие файлы больше не требуют «Принять» (без лишних уведомлений/полосок в списке диалогов)",
      "Файлы: оффер не пересылается повторно при каждом логине (без «мигания» уведомлений)",
    ],
    improved: [
      "Уведомления: входящие файлы показывают системное уведомление, когда вкладка скрыта",
      "Уведомления: входящие файлы отправляют Web Push, если получатель оффлайн",
      "Info: «История изменений» — только последние 5 записей (без «Показать ещё»)",
      "Тех.: client_info отправляет device_id/run_id + platform hints (web/PWA) для диагностики",
    ],
  },
  {
    version: "0.1.626",
    date: "2026-01-20",
    improved: ["Файлы: загрузка/скачивание через HTTP (/files) — без base64-чанков и со streaming/Range"],
    notes: ["Тех.: resumable upload (offset) + ACK file_downloaded → file_received"],
  },
  {
    version: "0.1.625",
    date: "2026-01-20",
    fixed: ["История: альбом/группировка фото (2+ подряд) — убран «отступ справа» у msg-out; тайлы остаются безрамочными"],
  },
  {
    version: "0.1.623",
    date: "2026-01-20",
    improved: ["Info: «История изменений» показывает последние 5 записей (без кнопки «Показать ещё»)"],
  },
  {
    version: "0.1.622",
    date: "2026-01-20",
    notes: [
      "Info: обновили «Историю изменений» (теперь включает последние релизы)",
      "Обновление клиента: если после деплоя версия не изменилась — нажмите Ctrl/Cmd+U (или сделайте hard reload/перезапуск PWA)",
      "Тех.: версия web-клиента повышается перед production deploy (patch bump) — чтобы версия в Info всегда соответствовала релизу",
    ],
  },
  {
    version: "0.1.621",
    date: "2026-01-20",
    improved: [
      "Viewer: zoom по клику по картинке теперь с pan/scroll (можно двигать увеличенное изображение)",
      "История: медиа-сообщения (фото/видео/аудио/альбомы) — без рамок/«карточек»",
    ],
  },
  {
    version: "0.1.620",
    date: "2026-01-20",
    fixed: ["История: исходящие фото/видео больше не рисуются с большой «аурой»/пустотой вокруг медиа"],
  },
  {
    version: "0.1.619",
    date: "2026-01-20",
    improved: ["История: исходящие вложения (фото/видео/альбомы) визуально в правой зоне (не «по центру»)"],
    notes: ["Тех.: добавлен обязательный bump версии web-клиента перед production deploy"],
  },
  {
    version: "0.1.618",
    date: "2026-01-16",
    fixed: [
      "PWA/desktop: меню (контекстное) больше не дергается при фоновых обновлениях; клики не срываются",
      "История: восстановление медиа-превью из локального кэша батчами (меньше дерганья после перезагрузки)",
      "Файлы: отображаем отдельный список реально кэшированных файлов (CacheStorage)",
      "Кэш: при ошибке квоты делаем best-effort очистку старых файлов и повтор cache.put",
      "Медиа: aspect-ratio cache сохраняется между перезагрузками",
    ],
  },
  {
    version: "0.1.617",
    date: "2026-01-16",
    fixed: ["PWA: Service Worker не валит обновление при ошибках CacheStorage/квоты; fallback на сеть для index/ассетов"],
  },
  {
    version: "0.1.616",
    date: "2026-01-16",
    fixed: ["PWA: обновление стало надёжнее (устойчивый install, BUILD_ID от SW, recovery при залипании)"],
  },
  {
    version: "0.1.615",
    date: "2026-01-16",
    improved: ["Desktop PWA: история стабильнее при докачке/превью (якорь + aspect-ratio cache)"],
  },
  {
    version: "0.1.614",
    date: "2026-01-15",
    improved: ["Медиа: превью image/video с корректным ratio; video viewer без autoplay/mute; автопауза offscreen"],
  },
  {
    version: "0.1.613",
    date: "2026-01-15",
    fixed: ["iOS: композер «прилипает» к клавиатуре (без большого зазора снизу)"],
  },
  {
    version: "0.1.612",
    date: "2026-01-15",
    fixed: ["iOS: убрана чёрная полоса снизу при открытии по ссылке (fullscreen)"],
  },
  {
    version: "0.1.611",
    date: "2026-01-15",
    fixed: [
      "Desktop PWA: автообновление может примениться даже при черновике в композере (после паузы; черновики сохраняются)",
    ],
  },
  {
    version: "0.1.610",
    date: "2026-01-15",
    fixed: [
      "Mobile: выбранная строка в чатлисте/контактах не инвертирует текст (без белого текста на прозрачном фоне)",
    ],
  },
  {
    version: "0.1.609",
    date: "2026-01-12",
    improved: [
      "История: стабилизация положения при лэйаут-сдвигах (якорь на видимом сообщении)",
    ],
  },
  {
    version: "0.1.608",
    date: "2026-01-12",
    improved: [
      "История: стабильная ширина скролла (scrollbar-gutter) и анти-флап wide-режима",
    ],
  },
  {
    version: "0.1.607",
    date: "2026-01-12",
    improved: [
      "История: кеш используется раньше (без лишней перезагрузки), подгрузка без зацикливания",
      "История: выравнивание текста сообщений стабилизировано",
    ],
  },
  {
    version: "0.1.606",
    date: "2026-01-12",
    improved: [
      "История: ширина пузырей 85% и центрирование ленты сообщений (desktop)",
    ],
  },
  {
    version: "0.1.605",
    date: "2026-01-12",
    improved: [
      "Фото: максимальная ширина ограничена 75% окна истории сообщений (desktop)",
    ],
  },
  {
    version: "0.1.604",
    date: "2026-01-12",
    improved: [
      "Файлы: входящие медиа принимаются автоматически и сразу ставятся в загрузку",
      "Файлы: уведомление «Входящий файл» исчезает после авто-принятия",
    ],
  },
  {
    version: "0.1.603",
    date: "2026-01-12",
    fixed: [
      "Файлы: принятие входящих файлов запускает авто-скачивание при зависании",
      "Файлы: входящий файл в открытом чате сразу помечается прочитанным",
      "Чатлист: индикатор упоминания не залипает после прочтения",
    ],
  },
  {
    version: "0.1.602",
    date: "2026-01-12",
    improved: [
      "Диалоги: desktop-типографика и геометрия строк ближе к tweb",
      "Контакты: компактные строки выровнены по высоте и ритму",
      "Mobile: хвостовая колонка и размеры аватаров стабильнее в списке",
    ],
  },
  {
    version: "0.1.601",
    date: "2026-01-12",
    improved: [
      "Медиа: размеры и ratio приведены к tweb (desktop 420×400, mobile 340×340)",
      "Альбомы: ширина/зазор сетки ближе к tweb (gap 1px)",
    ],
  },
  {
    version: "0.1.600",
    date: "2026-01-12",
    fixed: ["Медиа: предотвращены прыжки истории при догрузке фото/видео"],
    improved: [
      "Медиа: фиксированный кадр для фото/видео без динамической смены aspect-ratio",
      "Альбомы: жёсткая сетка и стабильные размеры ячеек в истории",
    ],
  },
  {
    version: "0.1.599",
    date: "2026-01-12",
    fixed: [
      "История: устранено пустое пространство над первым сообщением при полной загрузке",
      "История: автоповторы таймаута не мигают лоадером",
    ],
    improved: ["История: автозагрузка старых сообщений не срабатывает на автоскролле/сдвигах лейаута"],
  },
  {
    version: "0.1.598",
    date: "2026-01-12",
    fixed: ["История: снижены рывки/мигание при первичной загрузке (автоскролл ждёт историю)"],
    improved: ["История: warmup-подгрузка не стартует, пока активный чат ещё загружается"],
  },
  {
    version: "0.1.597",
    date: "2026-01-12",
    fixed: ["Видео: звук по умолчанию выключен, автоплей остаётся без аудио"],
  },
  {
    version: "0.1.596",
    date: "2026-01-12",
    improved: ["Mobile: нижнее меню «Сообщения/Профиль/Файлы» убрано"],
  },
  {
    version: "0.1.595",
    date: "2026-01-12",
    improved: [
      "История: адаптивные пороги виртуализации для mobile/slow network, меньше перегрузки при скролле",
      "История: кеш расширен и сохраняется при сворачивании вкладки",
      "Сообщения: meta-время и нижние отступы ровнее, меньше пересечений текста",
      "Контакты: tail-колонка стабильнее по высоте/ширине, ритм строки ровнее",
      "Медиа: повторное восстановление превью из кеша + центрирование в альбомах",
      "PWA: принудительное обновление делает hard reload при спорных версиях; iOS-подсказка короче",
      "Файлы: индикатор прогресса компактнее",
    ],
  },
  {
    version: "0.1.594",
    date: "2026-01-12",
    improved: [
      "История: sticky-даты и line-height ближе к tweb, меньше наложений при прокрутке",
      "Сообщения: meta-отступ и межстрочный ритм стабильнее на desktop/mobile",
      "Контакты: tail-колонка распределяет время/бейджи без пересечений",
      "Медиа: prefetch/очередь file_get адаптируются под медленную сеть и Save-Data",
      "История: warmup/preview паузятся в скрытой вкладке и при Save-Data",
    ],
  },
  {
    version: "0.1.593",
    date: "2026-01-12",
    improved: [
      "История: адаптивная параллельная прогрузка (5–7 потоков) и более мягкие лимиты на mobile",
      "История: расширен кеш (дольше хранится и больше сообщений на чат)",
      "Сообщения: увеличен нижний отступ и meta-время ниже текста на desktop/mobile",
      "Контакты: хвостовая колонка шире, сетка строк стабильнее при ресайзе",
      "PWA: принудительное обновление использует updateLatest при устаревшем build id, автоапдейт не мешает загрузке",
    ],
  },
  {
    version: "0.1.592",
    date: "2026-01-12",
    improved: [
      "История: отступ времени ниже текста стабильнее на desktop/mobile",
      "Медиа: inline видео получило play/pause поверх превью, авторазмер без лишнего кропа",
      "Альбомы фото: сетка плотнее и адаптивнее на мобильных экранах",
      "Контакты: типографика и хвостовая колонка чище, меньше пересечений",
      "PWA: install toast центрируется с безопасными отступами и переносами",
    ],
  },
  {
    version: "0.1.591",
    date: "2026-01-12",
    improved: [
      "История: альбомы фото группируются начиная с 2 сообщений, сетка плотнее и стабильнее",
      "Медиа: авторазмер превью фиксирует aspect-ratio без рывков",
      "Аудио: плейсхолдер + автоподгрузка в истории, контроль play/pause",
      "Шапка/подвал: более ровные тени и аккуратный фон",
    ],
  },
  {
    version: "0.1.590",
    date: "2026-01-11",
    improved: [
      "История: снижена нагрузка на mobile при фоновой прогрузке",
      "Медиа: очередь file_get (до 10 параллельно, prefetch 5-7) и расширенный кеш",
      "Фото/видео: стабилизирован aspect-ratio, автофокус по центру без резких прыжков",
      "Видео: auto-play в истории и viewer, звук по умолчанию выключен",
      "Видео: сервер конвертирует неподдерживаемые форматы в mp4",
    ],
  },
  {
    version: "0.1.589",
    date: "2026-01-11",
    improved: [
      "История: колонка сообщений, поиск и шапка прижаты к левому краю (меньше центрирования)",
      "Сообщения: больше вертикальный ритм, meta переносится и стабильно ниже текста",
      "Контакты: заголовок/время не пересекаются, ритм строк устойчивее",
      "Медиа: превью шире, увеличена максимальная высота",
      "История: усилена параллельная прогрузка и расширен кеш",
    ],
    fixed: ["История: даты не перекрывают друг друга при прокрутке"],
  },
  {
    version: "0.1.588",
    date: "2026-01-11",
    improved: [
      "Шапка/подвал: более чёткое разделение (тень/фон) и аккуратные отступы",
      "История: увеличен отступ meta — время стабильнее ниже текста на desktop/mobile",
      "Сообщения: уменьшен горизонтальный паддинг пузырей и более ровный вертикальный ритм",
      "Контакты: tail‑колонка выровнена, читаемость заголовков/времени улучшена",
      "Медиа: увеличена максимальная ширина превью (особенно на desktop wide)",
    ],
  },
  {
    version: "0.1.587",
    date: "2026-01-11",
    improved: [
      "История: wide‑layout прижимает колонку к левому краю и расширяет контейнер сообщений",
      "Сообщения: увеличен отступ meta (время ниже текста), меньше наложений",
      "Медиа: превью изображений/видео крупнее и устойчивее по ширине",
      "Контакты: шире tail‑колонка и правые отступы заголовков",
      "История: усилена параллельная прогрузка и увеличен кеш",
      "Файлы: индикатор прогресса компактнее и вращается",
      "PWA install toast: ширина адаптируется под экран, длинные строки переносятся",
    ],
    fixed: ["PWA: принудительное обновление использует updateLatest при устаревшем build id"],
  },
  {
    version: "0.1.585",
    date: "2026-01-11",
    improved: [
      "История: стабильнее вертикальный ритм и отступы meta (время ниже текста)",
      "История: wide‑layout активируется раньше, колонка шире и без центрирования",
      "Контакты: геометрия и шрифты ближе к tweb (высота/тайминги/подзаголовок)",
      "Медиа: увеличена ширина превью на desktop wide",
      "История: усилена параллельная прогрузка и расширен локальный кеш",
    ],
  },
  {
    version: "0.1.584",
    date: "2026-01-11",
    improved: [
      "История: более широкая колонка, увеличенный вертикальный ритм и стабильная meta‑строка",
      "Сообщения: увеличены внутренние отступы и межстрочные интервалы (desktop/mobile)",
      "Медиа: превью изображений/видео крупнее и стабильнее по ширине",
      "Контакты: более ровная сетка и выравнивание tail/таймингов",
      "История: увеличены лимиты кеша и параллельная прогрузка",
    ],
  },
  {
    version: "0.1.583",
    date: "2026-01-11",
    improved: [
      "История: шире колонка сообщений на desktop и стабильные отступы при ресайзе",
      "Сообщения: больше вертикального ритма и перенос meta без налезаний",
      "Контакты: выравнивание хвоста и плотность строк на desktop/mobile",
      "История: увеличена параллельная прогрузка и объём локального кеша",
      "Файлы: прогресс загрузки компактнее, без текстовой плашки",
    ],
  },
  {
    version: "0.1.582",
    date: "2026-01-11",
    improved: [
      "PWA desktop: история и инпут тянутся к левому краю, без центрирования колонки",
      "Сообщения: увеличен отступ времени и межстрочный ритм, меньше налезаний",
      "История: sticky-даты читаемее и стабильнее при прокрутке",
      "PWA: install toast на mobile компактнее и не выходит за границы",
    ],
    fixed: ["PWA: принудительное обновление делает ручной reload даже без waiting (fallback)"],
  },
  {
    version: "0.1.581",
    date: "2026-01-11",
    improved: [
      "Файлы: прогресс загрузки/скачивания теперь компактный круговой индикатор (без полосы)",
      "Файлы: статус загрузки компактнее, без процента в тексте",
    ],
  },
  {
    version: "0.1.580",
    date: "2026-01-11",
    improved: [
      "История: фоновая параллельная подгрузка нескольких чатов для ускоренного открытия",
      "История: кеш учитывает пустые чаты и курсоры для стабильного восстановления",
      "Сообщения: время отступает ниже текста (без налезания) на desktop/mobile",
      "PWA: install toast центрируется и ограничен по высоте экрана",
    ],
    fixed: ["PWA: update_required учитывает версии без build-hash для автообновления"],
  },
  {
    version: "0.1.579",
    date: "2026-01-11",
    improved: [
      "История: фоновая prefetch-подгрузка после первичной загрузки (параллельный before/delta)",
      "Сообщения: капшены медиа ближе к пузырю (меньше лишних зазоров)",
      "Медиа: time-бейдж на just-media читаемее на светлых превью",
      "Mobile: пузырь истории шире на узких экранах (меньше «узких» сообщений)",
    ],
    fixed: ["PWA: принудительное обновление не залипает на ожидании Service Worker (timeout ready)"],
  },
  {
    version: "0.1.578",
    date: "2026-01-11",
    improved: ["PWA: install toast на mobile центрируется и переносит длинный текст/кнопки без выхода за границы"],
  },
  {
    version: "0.1.577",
    date: "2026-01-11",
    fixed: [
      "PWA: принудительное обновление использует updateLatest как fallback для build id",
      "PWA: ручное обновление при updateLatest делает hard reload с восстановлением (boot recover)",
    ],
  },
  {
    version: "0.1.576",
    date: "2026-01-11",
    fixed: [
      "PWA: update_required с build id регистрирует SW при отсутствии и пробрасывает build id в автообновление",
      "PWA: кнопка «Обновить» использует hard reload с восстановлением (boot recover)",
    ],
  },
  {
    version: "0.1.575",
    date: "2026-01-11",
    improved: [
      "PWA: обновление учитывает BUILD_ID без waiting (skipWaiting) и перезапускает при новой сборке",
      "PWA: принудительное обновление запрашивает build id у SW и регистрирует SW при необходимости",
    ],
  },
  {
    version: "0.1.574",
    date: "2026-01-11",
    improved: [
      "История: клиентский кэш последних сообщений и курсоров (быстрее открытие чатов)",
      "История: параллельные before/since запросы для устойчивой синхронизации",
      "Сообщения: выровнены внутренние отступы и хвосты без артефактов (telegram-exact)",
      "Медиа: подписи под вложениями компактнее (telegram-exact)",
    ],
  },
  {
    version: "0.1.573",
    date: "2026-01-11",
    improved: [
      "Скины: оставлен только Telegram (точный)",
      "Медиа: cache-first автоподгрузка превью с типами по data-attrs",
    ],
    fixed: ["Сообщения: артефакт квадратного tail устранён (tweb-маска)"],
  },
  {
    version: "0.1.572",
    date: "2026-01-11",
    improved: [
      "Медиа: распознавание фото/видео/аудио по имени устойчиво к префиксам и скобкам",
      "История/медиа: автоподгрузка превью и истории повторяется после обновления списка/трансферов",
    ],
  },
  {
    version: "0.1.571",
    date: "2026-01-11",
    improved: [
      "Сообщения: интервалы групп/пузырей выровнены под tweb (telegram-exact)",
      "Медиа: автоподгрузка превью запускается сразу после рендера истории",
      "История: автодогрузка по высоте после рендера (стабильнее первичная загрузка)",
    ],
  },
  {
    version: "0.1.570",
    date: "2026-01-11",
    improved: ["Сообщения: DM без имён/аватаров, группы — ближе к tweb (telegram-exact)"],
  },
  {
    version: "0.1.569",
    date: "2026-01-11",
    improved: ["Сообщения: группировка имён/аватаров ближе к tweb (telegram-exact)"],
  },
  {
    version: "0.1.568",
    date: "2026-01-11",
    improved: [
      "Сообщения: метаданные времени встроены в bubble (telegram-exact, ближе к tweb)",
      "Медиа: превью в чате обновляются при прогрессе/готовности файла",
    ],
    fixed: ["История: «Загрузить ещё» доступна при наличии cursor даже без has_more"],
  },
  {
    version: "0.1.567",
    date: "2026-01-11",
    improved: ["Медиа: в viewer добавлена кнопка перехода к сообщению и полирован topbar (tweb)"],
  },
  {
    version: "0.1.566",
    date: "2026-01-11",
    improved: ["Медиа: в viewer добавлен topbar с автором и датой, ближе к tweb"],
    fixed: ["История: hasMore заполняется на любом непустом ответе без has_more (не «залипает» без «Загрузить ещё»)"],
  },
  {
    version: "0.1.565",
    date: "2026-01-11",
    improved: ["История: кнопка «Загрузить ещё» теперь появляется после первичного хвоста при отсутствии has_more"],
    fixed: ["История: historyHasMore заполняется на первичной подгрузке, чтобы не «залипать» без кнопки"],
  },
  {
    version: "0.1.564",
    date: "2026-01-11",
    improved: ["Сообщения: bubble-токены tweb для паддингов/радиусов (telegram-exact, меньше «разброса»)"],
    fixed: ["Медиа: распознавание фото/видео/аудио учитывает имена с разделителями/путями/параметрами (ENG/RU)"],
  },
  {
    version: "0.1.563",
    date: "2026-01-11",
    improved: ["Компоузер: вертикальные отступы и gap ближе к tweb, safe-area учитывается без среза"],
    fixed: ["Медиа: фото/видео/аудио распознаются по имени без расширения (ENG/RU), авто-подгрузка превью"],
  },
  {
    version: "0.1.562",
    date: "2026-01-11",
    improved: [
      "История/сообщения: ширина колонки совпадает с композером без дополнительного сужения",
      "Сообщения: max-width пузырей 85% от контейнера без жёсткого cap (tweb)",
      "Сообщения: более плотный внутренний ритм (gap 2px)",
    ],
    fixed: ["Медиа: превью фото/видео распознаются по имени без расширения (img/photo/video)"],
  },
  {
    version: "0.1.561",
    date: "2026-01-11",
    improved: [
      "Сообщения: tweb‑палитра пузырей и max-width 85% (telegram-exact)",
      "Сообщения: плоские пузыри без лишней тени (telegram-exact)",
      "Контакт-лист: menu-open фон ближе к tweb; активная строка только на десктопе",
    ],
  },
  {
    version: "0.1.560",
    date: "2026-01-11",
    improved: ["Фон истории/контактов ближе к tweb (telegram-exact)", "Chat padding 13/8 как в tweb"],
  },
  {
    version: "0.1.559",
    date: "2026-01-11",
    improved: ["История/сообщения: ширина колонки ближе к tweb (bubbles-inner)", "Контакт-лист: фон ближе к tweb"],
  },
  {
    version: "0.1.558",
    date: "2026-01-11",
    improved: ["История: автодогрузка не блокируется при неопределённом has_more (меньше «залипаний»)"],
    fixed: ["Медиа: битые превью сбрасываются и перезапрашиваются быстрее"],
  },
  {
    version: "0.1.557",
    date: "2026-01-11",
    improved: ["История: fallback подгрузки продолжает загрузку, пока сервер возвращает строки (меньше «залипаний»)"],
    fixed: ["Медиа: автоподгрузка превью работает даже при пустом mime/неполном имени файла"],
  },
  {
    version: "0.1.556",
    date: "2026-01-11",
    improved: ["Сообщения: имена/аватары в группах/досках группируются по tweb (имя на первом, аватар на tail)"],
    fixed: ["Медиа: автоподгрузка превью работает даже при неизвестном mime"],
  },
  {
    version: "0.1.555",
    date: "2026-01-11",
    improved: ["Сообщения: tweb‑типографика (16px/1.3125, meta 12px, автор 14px)"],
  },
  {
    version: "0.1.554",
    date: "2026-01-11",
    improved: ["Медиа: превью используют fileId/mime из transfer/offer, меньше пустых фото"],
  },
  {
    version: "0.1.553",
    date: "2026-01-11",
    improved: ["Сообщения: max-width пузырей ограничен 30rem (tweb), меньше «длинных капель»"],
  },
  {
    version: "0.1.552",
    date: "2026-01-11",
    improved: ["История/сообщения: ширина колонки всегда совпадает с композером (tweb)"],
  },
  {
    version: "0.1.551",
    date: "2026-01-11",
    improved: [
      "История: авто-повтор загрузки, если история не подгружена",
      "История/сообщения: ширина колонки выровнена с композером (tweb)",
    ],
    fixed: ["Медиа: прогрев превью из кэша не зависит от historyLoaded"],
  },
  {
    version: "0.1.550",
    date: "2026-01-11",
    improved: ["История: retry-плашка теперь доступна даже при наличии локальных сообщений"],
  },
  {
    version: "0.1.549",
    date: "2026-01-11",
    improved: [
      "История: добавлена кнопка повтора при неудачной загрузке",
      "История: ширина контейнера сообщений учитывает chat-input padding (tweb)",
      "Сообщения: max-width пузырей 85% от контейнера (tweb)",
      "Медиа: альбомы и пустые превью держат tweb-ширину/аспект",
    ],
  },
  {
    version: "0.1.548",
    date: "2026-01-11",
    improved: ["Сообщения: скругления групповых пузырей выровнены по tweb (mid-bubble)"],
  },
  {
    version: "0.1.547",
    date: "2026-01-11",
    improved: ["История: увеличен отступ после группы (tweb bubble-margin-big)"],
  },
  {
    version: "0.1.546",
    date: "2026-01-11",
    improved: [
      "Сообщения: окно группировки 121s, как в tweb (меньше «слипшихся» блоков)",
      "Медиа: альбомы группируются в том же окне (ближе к tweb)",
    ],
  },
  {
    version: "0.1.545",
    date: "2026-01-11",
    improved: [
      "Сообщения: включены bubble-tail в tweb-ритме (мягкая геометрия)",
      "История: групповые отступы выровнены с gap истории",
    ],
  },
  {
    version: "0.1.544",
    date: "2026-01-11",
    improved: [
      "Сообщения: max-width пузырей приведен к tweb (30rem)",
      "История: расстояние между сообщениями ближе к tweb (gap 2px)",
    ],
    fixed: ["Медиа: превью всегда сохраняют file_id для восстановления при битом url"],
  },
  {
    version: "0.1.543",
    date: "2026-01-11",
    improved: [
      "История: ширина контейнера сообщений приведена к tweb (max-width с учетом отступов)",
      "Сообщения: max-width пузырей рассчитывается от ширины контейнера истории (tweb 85%)",
    ],
    fixed: [
      "История: подгрузка не залипает, если сервер отдает has_more=0 при полном лимите",
      "Медиа: повторная автодогрузка превью при неудачной загрузке",
    ],
  },
  {
    version: "0.1.542",
    date: "2026-01-11",
    improved: [
      "Сообщения: ширина пузыря под контент (tweb‑поведение, без «длинных капель»)",
      "История: подгрузка менее хрупкая при отсутствии has_more в ответе сервера",
      "Медиа: превью изображений загружаются сразу (без зависания lazy‑режима)",
    ],
  },
  {
    version: "0.1.541",
    date: "2026-01-11",
    improved: [
      "Медиа: ширины превью/аудио/альбомов выровнены под сообщения (tweb‑ритм)",
      "Медиа: hover‑трансформации отключены для более стабильного вида",
    ],
  },
  {
    version: "0.1.540",
    date: "2026-01-11",
    improved: [
      "Сообщения: ширина пузырей, хвосты и DM‑выравнивание ближе к tweb",
      "История: контейнер сообщений стабилен при скролле и ререндере",
    ],
    fixed: [
      "История: добавлен таймаут и автоповтор запросов, чтобы не зависала подгрузка",
      "Медиа: автодогрузка превью фото работает и для входящих файлов",
    ],
  },
  {
    version: "0.1.539",
    date: "2026-01-11",
    improved: ["История: системные сообщения оформлены service-плашкой как в tweb"],
  },
  {
    version: "0.1.538",
    date: "2026-01-11",
    improved: [
      "История: пустой чат центрирован и оформлен как service-плашка (tweb)",
      "История: для пустого чата убран нижний псевдо‑отступ",
    ],
  },
  {
    version: "0.1.537",
    date: "2026-01-11",
    improved: [
      "Медиа: just‑media использует highlight‑фон для тайм‑бейджа (tweb)",
      "Медиа: тайм‑бейдж чуть отступает от правого/нижнего края (tweb)",
    ],
  },
  {
    version: "0.1.536",
    date: "2026-01-11",
    improved: [
      "Медиа: just‑media мета выровнена по правому краю (как в tweb)",
      "Медиа: тайм‑фон для image/video без текста — по message‑time background",
    ],
  },
  {
    version: "0.1.535",
    date: "2026-01-11",
    improved: [
      "Медиа: видео без текста тоже в режиме just‑media (без пузыря)",
      "Медиа: image/video превью без рамки и hover‑карточки",
    ],
  },
  {
    version: "0.1.534",
    date: "2026-01-11",
    improved: [
      "Медиа: image‑only вложения без пузыря (just‑media, прозрачный фон)",
      "Сообщения: лишняя карточка вокруг одиночных фото убрана",
    ],
  },
  {
    version: "0.1.533",
    date: "2026-01-11",
    improved: [
      "Медиа: изображения без текста теперь без обрезки (contain, без hover‑зума)",
      "История: кнопка «Загрузить ещё» оформлена как разделитель, ближе к tweb",
    ],
  },
  {
    version: "0.1.532",
    date: "2026-01-11",
    improved: [
      "Медиа: тайм‑бейдж и кнопки поверх превью читаемее (фон + blur)",
      "Медиа: лёгкий нижний градиент и более воздушная подпись у вложений",
    ],
  },
  {
    version: "0.1.531",
    date: "2026-01-11",
    improved: [
      "Медиа-превью: лимиты размеров ближе к tweb (420/451px)",
      "Медиа-превью: max-height видео/фото под tweb (400px)",
    ],
  },
  {
    version: "0.1.530",
    date: "2026-01-11",
    improved: [
      "Файлы в истории: тюнинг размеров/типографики и иконки под tweb",
      "Файлы в истории: кнопка скачивания компактнее и ближе к tweb",
    ],
  },
  {
    version: "0.1.529",
    date: "2026-01-11",
    improved: [
      "Файлы в истории: карточка документа ближе к tweb (иконка, отступы, высота)",
      "Файлы в истории: типографика имени и meta выровнены под tweb",
    ],
  },
  {
    version: "0.1.528",
    date: "2026-01-11",
    improved: [
      "Viewer overlay: переключатели prev/next добавлены в боковые зоны (tweb-поведение)",
      "Viewer overlay: стрелки появляются при наведении и не перекрывают подпись",
    ],
  },
  {
    version: "0.1.527",
    date: "2026-01-11",
    improved: [
      "Viewer overlay: topbar кнопки и навигация ближе к tweb (минимальная хрома, hover-opacity)",
      "Viewer overlay: подписи к медиа аккуратнее (line-height, прозрачность, hover/focus, mobile align)",
    ],
  },
  {
    version: "0.1.526",
    date: "2026-01-11",
    improved: ["История: date separators/headers ближе к tweb (размер, отступы, типографика)"],
  },
  {
    version: "0.1.525",
    date: "2026-01-11",
    improved: [
      "Медиа: play‑overlay ближе к tweb (фон/геометрия/иконка)",
      "Медиа: кнопки действий поверх превью приведены к tweb‑стилю",
    ],
  },
  {
    version: "0.1.524",
    date: "2026-01-11",
    improved: [
      "Медиа: тайм‑бейджи на вложениях ближе к tweb (позиция, плотность, фон)",
      "Сообщения: фон time‑бейджей теперь берется из message‑time background (tweb‑token)",
    ],
  },
  {
    version: "0.1.523",
    date: "2026-01-10",
    improved: [
      "История: unread‑разделитель ближе к tweb (фон/ритм/line‑height)",
      "История: jump‑to‑bottom кнопка по tweb (позиция, размер, тени, бейдж)",
    ],
  },
  {
    version: "0.1.522",
    date: "2026-01-10",
    improved: [
      "Helper bar: reply/forward ближе к tweb (размеры, отступы, акцент, кнопка отмены)",
      "Панель действий: выбор сообщений выровнен под tweb (ширина, кнопки, ритм)",
    ],
  },
  {
    version: "0.1.521",
    date: "2026-01-10",
    improved: [
      "Viewer overlay: подпись поверх медиа (tweb‑позиция, max-height, градиент)",
      "Viewer overlay: компактные кнопки действий и download в шапке",
      "Viewer overlay: быстрый zoom для изображений (1x/2x + dblclick)",
    ],
  },
  {
    version: "0.1.520",
    date: "2026-01-10",
    improved: [
      "История: мета‑строка сообщений без лишнего верхнего отступа (tweb‑ритм)",
      "Ответы/пересылки: компактнее meta/preview, выровнены line‑height",
      "Медиа: подписи под вложениями приведены к размеру/line‑height основного текста",
    ],
  },
  {
    version: "0.1.519",
    date: "2026-01-10",
    improved: [
      "История: более tweb‑группировка (ровный внутренний ритм + больше воздуха между группами)",
      "Ответы/пересылки: компактный preview с clamp до 2 строк",
      "Медиа: тайм‑бейдж подогнан по tweb (18px высота, аккуратный паддинг)",
      "Сообщения: подписи и превью с выровненным line-height",
    ],
  },
  {
    version: "0.1.518",
    date: "2026-01-10",
    improved: [
      "История: группировка сообщений ближе к tweb (компактный внутренний ритм + больше воздуха между группами)",
      "Ответы/пересылки: компактный блок preview, переносы и защита от overflow",
      "Медиа: альбомы плотнее (2px gap), аккуратные скругления, time‑badge читаемее",
      "Сообщения: мета‑строка и имена аккуратнее (ellipsis для длинных имён)",
    ],
  },
  {
    version: "0.1.517",
    date: "2026-01-10",
    improved: [
      "История: tweb‑ширина колонки (728px) и bubble max‑width 85% от контейнера",
      "Композер: выровненные размеры/отступы по tweb (chat‑pad ~13px, input 54px)",
      "Wide‑режим: убрано растягивание сообщений до краёв",
      "Типографика: базовый размер сообщений 16px и мета 12px",
    ],
  },
  {
    version: "0.1.516",
    date: "2026-01-10",
    improved: [
      "История: tweb‑ритм отступов и ширины пузырей, выверенные радиусы в группах",
      "Медиа: превью в пузыре без лишних отступов, аккуратные оверлей‑кнопки",
      "Сообщения: компактнее мета‑строка и тайм‑бэйдж для медиа без подписи",
    ],
  },
  {
    version: "0.1.515",
    date: "2026-01-10",
    improved: ["Обновления: при update_required с build id запускаем SW update без модального окна"],
  },
  {
    version: "0.1.514",
    date: "2026-01-10",
    improved: [
      "PWA: офлайн‑очередь исходящих сообщений и автодосылка через Background Sync",
      "PWA: тихие push‑сигналы пробуждают синхронизацию очереди",
      "Outbox: синхронизация статусов с сервис‑воркером и очистка при разлогине",
    ],
  },
  {
    version: "0.1.513",
    date: "2026-01-10",
    improved: [
      "История: колонка и композер выровнены по общему max-width, аккуратный центр без прилипания к краям",
      "Сообщения: обновлены слои/радиусы/мета по 8px‑сетке, исходящие без аватаров и лишней шапки",
      "Ответы/пересылки/вложения: защита от overflow и более крупные превью",
    ],
  },
  {
    version: "0.1.512",
    date: "2026-01-10",
    improved: [
      "История: колонка сообщений расширена и выровнена влево, единая сетка 8px и читабельный max-width",
      "Сообщения: мягкие карточки без хвостов, единый стиль пузырей/меты во всех скинах",
      "Вложения/ответы: упрощённые блоки, аккуратные отступы и контроль overflow",
      "Dark premium: обновлена палитра и кнопка отправки без фиолетового градиента",
    ],
  },
  {
    version: "0.1.511",
    date: "2026-01-10",
    improved: [
      "История: раскладка сообщений приведена к Telegram/tweb (радиусы 15/5, tail-форма как в tweb)",
      "История: ритм и зазоры повторяют tweb (2px gap, line-height 1.3125, паддинги 8/4/5)",
      "Мета: время и статусы выровнены вправо внутри bubble, как в tweb",
    ],
  },
  {
    version: "0.1.510",
    date: "2026-01-09",
    improved: [
      "Layout: колонка сообщений и композер выровнены по tweb (728px, центрированная колонка)",
      "Сообщения: bubble‑ширина 85% от колонки, исходящие выравнены вправо",
      "Композер: иконки внутри поля, размеры/зазоры приведены к tweb",
    ],
  },
  {
    version: "0.1.509",
    date: "2026-01-09",
    improved: [
      "История: ширина колонки сообщений ограничена по phi и выровнена по левому краю",
      "История: более собранная типографика и ритм строк для читаемости",
      "Композер: уточнены размеры, зазоры и визуальное согласование кнопок с полем ввода",
    ],
  },
  {
    version: "0.1.508",
    date: "2026-01-09",
    improved: [
      "Композер: иконки вынесены в отдельные кнопки, поле ввода стало самостоятельным элементом",
      "Композер: уменьшена высота строки, выровнены размеры кнопок и поля",
    ],
  },
  {
    version: "0.1.507",
    date: "2026-01-09",
    improved: [
      "Desktop: история и композер растянуты на полную ширину во всех скинах",
      "История: bubble‑режим больше не ограничивает ширину контейнера сообщений",
    ],
  },
  {
    version: "0.1.506",
    date: "2026-01-09",
    improved: [
      "Desktop: убрано центрирование истории и строки ввода, ширина теперь 100%",
    ],
  },
  {
    version: "0.1.505",
    date: "2026-01-09",
    improved: [
      "Desktop: увеличена ширина истории сообщений и строки ввода",
    ],
  },
  {
    version: "0.1.504",
    date: "2026-01-09",
    improved: [
      "Desktop: визуально разделены история сообщений и поле ввода в диалоге",
    ],
  },
  {
    version: "0.1.503",
    date: "2026-01-09",
    improved: [
      "Viewer overlay: header/actions/caption выровнены по phi‑ритму",
      "Viewer overlay: размеры навигации и safe‑area подогнаны по phi‑пропорциям",
    ],
  },
  {
    version: "0.1.502",
    date: "2026-01-09",
    improved: [
      "Композер: helper bar для reply/forward выровнен по phi‑ритму",
      "Панель действий: кнопки и контейнер подогнаны по phi‑пропорциям",
    ],
  },
  {
    version: "0.1.501",
    date: "2026-01-09",
    improved: [
      "Композер: phi‑ритм размеров и отступов для кнопок/поля ввода",
      "Композер: более ровные пропорции safe‑area и gap между действиями",
    ],
  },
  {
    version: "0.1.500",
    date: "2026-01-09",
    fixed: [
      "PWA/Desktop: автообновление не блокируется фокусом на пустом композере",
      "PWA/Desktop: обновления применяются надёжнее без ручной перезагрузки",
    ],
  },
  {
    version: "0.1.499",
    date: "2026-01-09",
    improved: [
      "История: плоский список сообщений без карточек/пузырей, единая колонка",
      "История: уплотнена группировка и аккуратные блоки вложений/ответов",
    ],
  },
  {
    version: "0.1.498",
    date: "2026-01-09",
    improved: [
      "История: full-screen группировка одной колонкой (Jabber/TWeb) без пузырей и «ёлочки»",
      "История: мета/реакции слева и сгруппированные цепочки без повторных аватаров",
    ],
  },
  {
    version: "0.1.497",
    date: "2026-01-08",
    improved: [
      "История: phi‑отступы, центр‑колонна и контроль ширины сообщений в full‑screen",
      "История: логин/аватарки и блоки пересылки/ответа выровнены без выхода за границы",
    ],
  },
  {
    version: "0.1.496",
    date: "2026-01-08",
    improved: [
      "Сообщения: внешний вид и форма унифицированы под стиль dark-premium во всех скинах",
    ],
  },
  {
    version: "0.1.495",
    date: "2026-01-08",
    improved: [
      "Скины: Telegram (точный) теперь по умолчанию",
      "Скины: оставлены Telegram (точный), Тёмная премиум и Amber",
    ],
  },
  {
    version: "0.1.494",
    date: "2026-01-08",
    improved: [
      "Скины: оставлены только стандартный, Telegram и тёмная премиальная темы",
    ],
  },
  {
    version: "0.1.493",
    date: "2026-01-08",
    improved: [
      "История: золотое сечение в геометрии, ритме и цветах сообщений",
      "История: более плавные джампы прокрутки (phi-скорость)",
    ],
  },
  {
    version: "0.1.492",
    date: "2026-01-08",
    improved: [
      "История: карточки сообщений более плоские и менее «пузырьковые» во всех скинах",
    ],
  },
  {
    version: "0.1.491",
    date: "2026-01-08",
    improved: [
      "Mobile: список в сайдбаре без лишнего отступа перед первым заголовком",
    ],
  },
  {
    version: "0.1.490",
    date: "2026-01-08",
    improved: [
      "Сайдбар: поиск с иконкой и более заметным фокусом",
      "Сайдбар: clear-кнопка поиска реагирует сразу и возвращает фокус",
    ],
  },
  {
    version: "0.1.489",
    date: "2026-01-08",
    improved: [
      "Контакты: в списке показывается статус (онлайн/last seen) и @handle",
      "Контакты: порядок контактов — online-first, затем last seen и имя",
      "Контакты: в табе Контакты убрана чат-мета (время/непрочитанные/реакции)",
    ],
  },
  {
    version: "0.1.488",
    date: "2026-01-08",
    improved: ["Контакты: добавлен заголовок секции для активного списка (tweb parity)"],
  },
  {
    version: "0.1.487",
    date: "2026-01-08",
    added: ["Сайдбар: архив контактов с переключателем в строке поиска (активные/архивные отдельно)"],
    improved: [
      "История: автодогрузка ранних сообщений начинается раньше при прокрутке вверх",
      "История: разделитель непрочитанных показывает количество",
      "Темы Telegram: menu-open фон в списке чатов выровнен с tweb",
    ],
  },
  {
    version: "0.1.486",
    date: "2026-01-07",
    fixed: ["PWA: принудительное обновление больше не показывает ошибку, если обновлений нет"],
  },
  {
    version: "0.1.485",
    date: "2026-01-07",
    improved: [
      "История: классический вид — пузыри не растягиваются на всю ширину",
      "История: классический вид — более плоские карточки без полос/глянца",
    ],
  },
  {
    version: "0.1.484",
    date: "2026-01-07",
    improved: [
      "История: вложения и подписи выровнены по отступам пузырей во всех скинах",
      "История: мета у вложений учитывает направление (in/out) и не съезжает",
    ],
  },
  {
    version: "0.1.483",
    date: "2026-01-05",
    fixed: [
      "PWA: исправлен цикл перезагрузки при совпадении версии и build-hash (активный buildId сохраняется)",
      "PWA: если SW уже активен и нет waiting — обновление не форсит перезагрузку",
    ],
  },
  {
    version: "0.1.482",
    date: "2026-01-05",
    fixed: [
      "PWA: авто‑обновление не замирает в ошибке — если SW уже активен, перезагружаемся; если нет — повторяем попытку",
      "PWA: убран блокирующий текст «Автообновление не удалось применить…» (заменено на тихий backoff)",
    ],
  },
];
