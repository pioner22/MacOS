# Dimanger: первичные технические источники

Проверены при подготовке проекта 5 ноября 2026 года. Источники подтверждают свойства существующих технологий и известные ограничения. Они не подтверждают безопасность, скорость или нераспознаваемость ещё не реализованного Dimanger.

| ID | Источник | Для какого решения используется |
| --- | --- | --- |
| S01 | [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html) | Синтаксис HTTP; TCP:80 не делает произвольный поток HTTP |
| S02 | [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) | Семантика HTTP, переключение протокола |
| S03 | [nginx: WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) | Поддержка переключения соединений и требования к проксированию |
| S04 | [Noise Protocol Framework, revision 34](https://noiseprotocol.org/noise.html) | Паттерны рукопожатия, свойства IK, управление состоянием и пределы сокрытия |
| S05 | [RFC 7748: Elliptic Curves for Security](https://www.rfc-editor.org/rfc/rfc7748.html) | X25519, представление значений и оценка стойкости |
| S06 | [RFC 8439: ChaCha20 and Poly1305 for IETF Protocols](https://www.rfc-editor.org/rfc/rfc8439.html) | Аутентифицированное шифрование и требования к nonce |
| S07 | [USENIX Security 2023: How the Great Firewall of China Detects and Blocks Fully Encrypted Traffic](https://www.usenix.org/conference/usenixsecurity23/presentation/wu-mingshi) | Реальная пассивная классификация полностью зашифрованных соединений |
| S08 | [NDSS 2020: Detecting Probe-resistant Proxies](https://www.ndss-symposium.org/ndss-paper/detecting-probe-resistant-proxies/) | Ограничения защиты молчанием и активное распознавание |
| S09 | [USENIX Security 2024: Fingerprinting Obfuscated Proxy Traffic with Encapsulated TLS Handshakes](https://www.usenix.org/conference/usenixsecurity24/presentation/xue-fingerprinting) | Поведенческие признаки вложенных протоколов |
| S10 | [RFC 9329, section 9.1: TCP-in-TCP](https://www.rfc-editor.org/rfc/rfc9329.html#section-9.1) | Задержки и деградация вложенного TCP при потерях |
| S11 | [Apple: Packet tunnel provider](https://developer.apple.com/documentation/networkextension/packet-tunnel-provider) | Системный пакетный VPN на macOS |
| S12 | [Apple TN3134: Network Extension provider deployment](https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment) | Варианты поставки, system extension и Developer ID |
| S13 | [Apple: Installing System Extensions and Drivers](https://developer.apple.com/documentation/systemextensions/installing-system-extensions-and-drivers) | Активация расширения, подпись и права |
| S14 | [Snow: официальный репозиторий реализации Noise на Rust](https://github.com/mcginty/snow) | Кандидат библиотеки; README предупреждает об отсутствии формального аудита |
| S15 | [The Update Framework Specification](https://theupdateframework.github.io/specification/latest/) | Модель доверия обновлений, подписи и противодействие навязанным старым метаданным |

## Проверенное состояние репозитория

На момент подготовки: [pioner22/MacOS](https://github.com/pioner22/MacOS), публичный репозиторий, ветка main, исходный коммит ede0a8ba309a5233117113726b606fec206b4743.

Проверены корневой README, правила структуры и механизм её проверки. Новая папка dimanger регистрируется как отдельный проект на стадии планирования. Существующие исходники диагностики, BigSurVPN и исторические точки входа не являются частью этой архитектурной реализации.
