These instructions apply to AdsPower.js.

Request handling
All HTTP requests to the AdsPower API must go through the internal request() method.
Never call axios.post(), axios.get(), axios.request(), or another Axios method directly inside public AdsPower methods.
Public methods such as openProfile(), closeProfile(), getProfileByNo(), and updateProfileTags() must call this.request().
Do not add manual setTimeout(), wait(), or request delays inside public methods.
Request queueing and the delay between AdsPower API requests must remain centralized inside request().
Keep one shared request queue so simultaneous calls execute sequentially.
Do not remove or bypass the request delay because AdsPower enforces API rate limits.
A failed request must not permanently block the request queue.

AdsPower ендпойнти актуальні для роботи з тегами профілів
POST /api/v2/browser-tags/list      — отримати список тегів AdsPower.

POST /api/v2/browser-tags/create    — створити новий тег.

POST /api/v2/browser-tags/update    — змінити назву або колір існуючого тегу.

POST /api/v2/browser-tags/delete    — повністю видалити тег з AdsPower.

POST /api/v2/browser-profile/update — додати, замінити або змінити теги конкретного профілю.