import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { errorDetails, unwrap } from "../lib/api.js";

const identifierFor = (geo, creativeName) => {
  const code = String(geo ?? "")
    .trim()
    .toUpperCase();
  const creativePart = String(creativeName ?? "")
    .split("_")[0]
    .trim();
  return code.length >= 2 && creativePart
    ? `${code[0]}J${creativePart}${code[1]}`
    : "";
};
const defaultCampaignGroup = (groups) =>
  groups.find((item) => String(item?.id ?? "") === "7")?.id ??
  groups.find((item) =>
    /^(myrahoi ppl|мурахоїд ппл)$/iu.test(String(item?.name ?? "")),
  )?.id ??
  "";

function Field({ label, children, className = "" }) {
  return (
    <label className={`campaign-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function InlineSearchSelect({ items, value, onChange, getId = (item) => item.id, getTitle = (item) => item.name, getSearchText, placeholder, ariaLabel }) {
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = items.find((item) => String(getId(item)) === String(value));
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((item) => String(getSearchText?.(item) ?? `${getTitle(item)} ${getId(item)}`).toLocaleLowerCase().includes(needle)) : items;
  }, [items, query, getId, getTitle, getSearchText]);
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return <div ref={root} className="campaign-inline-select"><input value={open ? query : (selected ? getTitle(selected) : "")} placeholder={placeholder} aria-label={ariaLabel} onFocus={() => { setQuery(""); setOpen(true); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} /><button type="button" className="campaign-inline-toggle" aria-label={open ? "Згорнути список" : "Розгорнути список"} onClick={() => { setQuery(""); setOpen((current) => !current); }}>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>{open && <div className="campaign-inline-options">{visible.length === 0 && <div>Нічого не знайдено.</div>}{visible.map((item) => <button type="button" key={getId(item)} onClick={() => { onChange(getId(item)); setOpen(false); setQuery(""); }}>{getTitle(item)}</button>)}</div>}</div>;
}

function ResourcePicker({
  title,
  items,
  value,
  onChange,
  getId = (item) => item.id,
  getTitle = (item) => item.name,
  multiple = false,
  emptyText,
  searchPlaceholder,
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(
    (multiple ? value : [value]).filter(Boolean).map(String),
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...items].filter(
      (item) =>
        !needle ||
        `${getId(item)} ${getTitle(item)}`.toLocaleLowerCase().includes(needle),
    );
  }, [items, query, getId, getTitle]);
  const toggle = (item) => {
    const id = String(getId(item));
    if (multiple)
      onChange(
        selected.has(id)
          ? value.filter((current) => String(current) !== id)
          : [...value, id],
      );
    else onChange(selected.has(id) ? "" : id);
  };
  return (
    <section className="campaign-resource-picker">
      <header>
        <strong>{title}</strong>
        <span>{multiple ? "Можна обрати кілька" : "Необов’язково"}</span>
      </header>
      <label className="campaign-resource-search">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>
      <div className="campaign-resource-list">
        {visible.length === 0 && (
          <div className="stream-empty-line">{emptyText}</div>
        )}
        {visible.map((item) => {
          const id = String(getId(item));
          const active = selected.has(id);
          return (
            <button
              type="button"
              key={id}
              className={active ? "selected" : ""}
              onClick={() => toggle(item)}
            >
              <span>
                <strong>{getTitle(item)}</strong>
                <small>ID {id}</small>
              </span>
              <i>
                {active ? (
                  multiple ? (
                    <Minus size={17} />
                  ) : (
                    <Check size={17} />
                  )
                ) : (
                  <Plus size={17} />
                )}
              </i>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LandingPickerModal({ landings, groups, selected, onToggle, onClose }) {
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("all");
  const selectedIds = new Set(selected.map((item) => String(item.landing_id)));
  const groupItems = [{ id: "all", name: "Усі" }, ...groups];
  const visible = landings.filter((item) => {
    const matchesGroup = groupId === "all" || String(item.groupId) === String(groupId);
    const needle = query.trim().toLocaleLowerCase();
    return matchesGroup && (!needle || `${item.id} ${item.name}`.toLocaleLowerCase().includes(needle));
  });
  return <div className="asset-picker-overlay campaign-landing-modal" role="dialog" aria-modal="true" aria-label="Додати лендінги White"><div className="asset-picker-modal"><header><div><h3>Додати лендінги</h3><p>Оберіть потрібні лендінги. Повторне натискання прибирає вибір.</p></div><button type="button" className="icon-button" aria-label="Закрити" onClick={onClose}><X size={18} /></button></header><div className="asset-picker-body"><div className="asset-picker-toolbar"><div className="asset-picker-search-field"><span>Пошук</span><label className="keitaro-search asset-picker-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук лендінгу за назвою або ID…" /></label></div><div className="asset-picker-group"><span>Група</span><InlineSearchSelect items={groupItems} value={groupId} onChange={setGroupId} placeholder="Усі" ariaLabel="Група лендінгів" /></div></div><div className="asset-picker-list">{visible.length === 0 && <div className="stream-empty-line">Лендінгів не знайдено.</div>}{visible.map((landing) => { const active = selectedIds.has(String(landing.id)); return <button type="button" key={landing.id} className={`asset-picker-item ${active ? "selected" : ""}`} onClick={() => onToggle(landing)}><span><strong>{landing.name}</strong><small>ID {landing.id}{landing.groupId ? ` · група ${landing.groupId}` : ""}</small></span>{active ? <Minus size={17} /> : <Plus size={17} />}</button>; })}</div></div></div></div>;
}

function WhiteLandingSection({ landings, groups, value, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const patch = (index, changes) => onChange(value.map((item, current) => current === index ? { ...item, ...changes } : item));
  const toggle = (landing) => {
    const exists = value.some((item) => String(item.landing_id) === String(landing.id));
    onChange(exists ? value.filter((item) => String(item.landing_id) !== String(landing.id)) : [...value, { landing_id: String(landing.id), share: 100, state: "active" }]);
  };
  return <section className="campaign-white-landings"><div className="stream-section-title"><strong>Лендінги</strong><button type="button" className="secondary-button" onClick={() => setPickerOpen(true)}><Plus size={15} /> Додати лендінги</button></div>{value.length === 0 && <div className="stream-empty-line">Нічого не додано</div>}{value.map((item, index) => { const landing = landings.find((source) => String(source.id) === String(item.landing_id)); const enabled = item.state !== "disabled"; return <div className="stream-asset-row" key={item.landing_id}><div><strong>{landing?.name || `Лендінг ${item.landing_id}`}</strong><small>ID {item.landing_id}{landing?.groupId ? ` · група ${landing.groupId}` : ""}</small></div><label><input type="number" min="0" max="100" disabled={!enabled} value={item.share} onChange={(event) => patch(index, { share: Math.max(0, Math.min(100, Number(event.target.value))) })} /> %</label><span className="stream-toggle-pair"><button type="button" className={enabled ? "active" : ""} onClick={() => patch(index, { state: "active" })}>Увімк.</button><button type="button" className={!enabled ? "active off" : ""} onClick={() => patch(index, { state: "disabled" })}>Вимк.</button></span><button type="button" className="icon-button danger" aria-label={`Видалити лендінг ${item.landing_id}`} onClick={() => onChange(value.filter((_, current) => current !== index))}><Trash2 size={15} /></button></div>; })}{pickerOpen && <LandingPickerModal landings={landings} groups={groups} selected={value} onToggle={toggle} onClose={() => setPickerOpen(false)} />}</section>;
}

function CountryPickerModal({ countries, selected, onToggle, onClose }) {
  const [query, setQuery] = useState("");
  const selectedCodes = new Set(selected.map((code) => String(code).toUpperCase()));
  const needle = query.trim().toLocaleLowerCase();
  const visible = countries.filter((country) => !needle || `${country.code} ${country.name} ${(country.aliases ?? []).join(" ")}`.toLocaleLowerCase().includes(needle));
  return <div className="asset-picker-overlay campaign-landing-modal" role="dialog" aria-modal="true" aria-label="Додати країни для виключення"><div className="asset-picker-modal"><header><div><h3>Додати країну</h3><p>Оберіть країни, які потрібно виключити для потоку White.</p></div><button type="button" className="icon-button" aria-label="Закрити" onClick={onClose}><X size={18} /></button></header><div className="asset-picker-body"><div className="asset-picker-toolbar campaign-country-toolbar"><div className="asset-picker-search-field"><span>Пошук</span><label className="keitaro-search asset-picker-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук країни за назвою або кодом…" /></label></div></div><div className="asset-picker-list">{visible.length === 0 && <div className="stream-empty-line">Країн не знайдено.</div>}{visible.map((country) => { const active = selectedCodes.has(String(country.code).toUpperCase()); return <button type="button" key={country.code} className={`asset-picker-item ${active ? "selected" : ""}`} onClick={() => onToggle(country.code)}><span><strong>{country.code} — {country.name}</strong></span>{active ? <Minus size={17} /> : <Plus size={17} />}</button>; })}</div></div></div></div>;
}

function CountryExclusionSection({ countries, value, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const toggle = (code) => {
    const normalizedCode = String(code).toUpperCase();
    const exists = value.some((item) => String(item).toUpperCase() === normalizedCode);
    onChange(exists ? value.filter((item) => String(item).toUpperCase() !== normalizedCode) : [...value, normalizedCode]);
  };
  return <section className="campaign-country-exclusions"><div className="stream-section-title"><strong>Країни виключити</strong><button type="button" className="secondary-button" onClick={() => setPickerOpen(true)}><Plus size={15} /> Додати країну</button></div>{value.length === 0 && <div className="stream-empty-line">Країни не додані</div>}{value.map((code) => { const country = countries.find((item) => String(item.code).toUpperCase() === String(code).toUpperCase()); return <div className="stream-asset-row campaign-country-row" key={code}><div><strong>{String(code).toUpperCase()} — {country?.name || "Невідома країна"}</strong></div><button type="button" className="icon-button danger" aria-label={`Видалити країну ${code}`} onClick={() => toggle(code)}><Trash2 size={15} /></button></div>; })}{pickerOpen && <CountryPickerModal countries={countries} selected={value} onToggle={toggle} onClose={() => setPickerOpen(false)} />}</section>;
}

export default function KeitaroCampaignCreateModal({
    onClose,
    onError,
    showToast,
    onCreated,
    initialGeo = "",
    initialCreativeName = "",
}) {
  const [settings, setSettings] = useState({
    pixels: [],
    defaultPixelId: "",
    domainsByGeo: {},
  });
  const [countries, setCountries] = useState([]);
  const [domains, setDomains] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sources, setSources] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [landings, setLandings] = useState([]);
  const [landingGroups, setLandingGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [geo, setGeo] = useState(initialGeo);
  const [creativeName, setCreativeName] = useState(initialCreativeName);
  const [pixelKey, setPixelKey] = useState("");
  const [manualPixel, setManualPixel] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [pixelToken, setPixelToken] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [whiteLandings, setWhiteLandings] = useState([{ landing_id: "123", share: 100, state: "active" }]);
  const [excludedCountries, setExcludedCountries] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [manualName, setManualName] = useState(false);
  const [name, setName] = useState("");
  const [manualIdentifier, setManualIdentifier] = useState(false);
  const [identifier, setIdentifier] = useState("");

  useEffect(() => {
    Promise.all([
      unwrap(window.adsBot.getKeitaroCampaignSettings()),
      unwrap(window.adsBot.getKeitaroCountries()),
      unwrap(window.adsBot.getKeitaroDomains()),
      unwrap(window.adsBot.getKeitaroCampaignGroups()),
      unwrap(window.adsBot.getKeitaroTrafficSources()),
      unwrap(window.adsBot.getKeitaroStreamTemplates()),
      unwrap(window.adsBot.getKeitaroLandingPages({ groupId: "all" })),
      unwrap(window.adsBot.getKeitaroAssetGroups("landings")),
    ])
      .then(
        ([
          nextSettings,
          nextCountries,
          nextDomains,
          nextGroups,
          nextSources,
          nextTemplates,
          nextLandings,
          nextLandingGroups,
        ]) => {
          setSettings(nextSettings);
          setCountries(nextCountries ?? []);
          setDomains(nextDomains ?? []);
          setGroups(nextGroups ?? []);
          setSources(nextSources ?? []);
          setTemplates(
            [...(nextTemplates ?? [])].sort((left, right) =>
              left.name.localeCompare(right.name, "uk-UA", {
                numeric: true,
                sensitivity: "base",
              }),
            ),
          );
          setLandings(nextLandings ?? []);
          setLandingGroups(nextLandingGroups ?? []);
          setPixelKey(nextSettings.defaultPixelId || "");
          setSourceId(
            (nextSources ?? []).find(
              (item) => item.name.toLocaleLowerCase() === "fb capi",
            )?.id ?? "",
          );
          setGroupId(defaultCampaignGroup(nextGroups ?? []));
        },
      )
      .catch((error) =>
        onError?.({
          ...errorDetails(error),
          title: "Не вдалося завантажити дані Keitaro",
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedPixel = settings.pixels.find((item) => item.id === pixelKey);
  const activePixelId = (
    manualPixel ? pixelId : (selectedPixel?.pixelId ?? "")
  ).trim();
  const activeToken = (
    manualPixel ? pixelToken : (selectedPixel?.token ?? "")
  ).trim();
  const automaticName =
    geo && creativeName.trim() && activePixelId
      ? `${geo} [${creativeName.trim()}] Pixel_${activePixelId}`
      : "";
  const mappedDomainIds = settings.domainsByGeo?.[geo] ?? [];
  const mappedSet = new Set(mappedDomainIds.map(String));
  const domainOptions = mappedSet.size
    ? domains.filter((item) => mappedSet.has(String(item.id)))
    : domains;
  const selectedDomain = domains.find(
    (item) => String(item.id) === String(domainId),
  );
  const campaignUrl =
    selectedDomain && identifier.trim()
      ? `https://${String(selectedDomain.name)
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "")}/${identifier.trim()}`
      : "";
  useEffect(() => {
    if (!manualName) setName(automaticName);
  }, [automaticName, manualName]);
  useEffect(() => {
    if (!manualIdentifier) setIdentifier(identifierFor(geo, creativeName));
  }, [geo, creativeName, manualIdentifier]);
  useEffect(() => {
    if (!geo) {
      setDomainId("");
      return;
    }
    setDomainId(mappedDomainIds.length === 1 ? String(mappedDomainIds[0]) : "");
    setExcludedCountries((current) =>
      current.includes(geo) ? current : [geo, ...current],
    );
  }, [geo]);
  const canCreate =
    !loading &&
    !creating &&
    name.trim() &&
    groupId &&
    domainId &&
    sourceId &&
    activePixelId &&
    activeToken &&
    geo &&
    identifier.trim() &&
    whiteLandings.length;
  const create = async () => {
    setCreating(true);
    try {
      await unwrap(
        window.adsBot.createKeitaroCampaign({
          name: name.trim(),
          groupId,
          domainId,
          trafficSourceId: sourceId,
          pixelId: activePixelId,
          pixelToken: activeToken,
          geo,
          excludedCountries,
          landings: whiteLandings,
          identifier: identifier.trim(),
          streamTemplateId: templateId || null,
        }),
      );
      showToast?.("Кампанію Keitaro створено", "success");
      onCreated?.();
      onClose();
    } catch (error) {
      onError?.({
        ...errorDetails(error),
        title: "Не вдалося створити кампанію Keitaro",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="stream-editor-overlay keitaro-campaign-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Створити кампанію Keitaro"
    >
      <div className="keitaro-campaign-editor">
        <header className="keitaro-campaign-head">
          <div className="campaign-title-editor">
            {manualName ? (
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Назва кампанії"
              />
            ) : (
              <h2>{name || "Нова кампанія"}</h2>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Ввести назву вручну"
              title="Ввести назву вручну"
              onClick={() => setManualName(true)}
            >
              <Pencil size={16} />
            </button>
            {manualName && (
              <button
                type="button"
                className="icon-button"
                aria-label="Повернути автоматичну назву"
                title="Повернути автоматичну назву"
                onClick={() => setManualName(false)}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрити"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="keitaro-campaign-body">
          {loading ? (
            <div className="campaign-loading">
              <LoaderCircle className="spin" size={19} /> Завантажуємо довідники
              Keitaro…
            </div>
          ) : (
            <div className="keitaro-campaign-layout">
              <section className="campaign-workspace-column campaign-main-column">
                <header>
                  <span className="eyebrow">Основні</span>
                  <h3>Кампанія</h3>
                </header>
                <div className="campaign-main-fields">
                  <div className="campaign-fields-grid">
                    <Field label="GEO">
                      <InlineSearchSelect
                        items={countries}
                        value={geo}
                        onChange={(value) => setGeo(String(value).toUpperCase())}
                        getId={(item) => item.code}
                        getTitle={(item) => item.code}
                        getSearchText={(item) => `${item.code} ${item.name} ${(item.aliases ?? []).join(" ")}`}
                        placeholder="Оберіть GEO"
                        ariaLabel="GEO кампанії"
                      />
                    </Field>
                    <Field label="Назва креативу">
                      <input
                        value={creativeName}
                        onChange={(event) =>
                          setCreativeName(event.target.value)
                        }
                        placeholder="001_W"
                      />
                    </Field>
                  </div>
                  <Field label="Група">
                    <InlineSearchSelect
                      items={groups}
                      value={groupId}
                      onChange={setGroupId}
                      placeholder="Оберіть групу"
                      ariaLabel="Група кампанії"
                    />
                  </Field>
                  <Field label="Домен">
                    <InlineSearchSelect
                      items={domainOptions}
                      value={domainId}
                      onChange={setDomainId}
                      placeholder={
                        mappedSet.size
                          ? "Домен цього GEO"
                          : "Оберіть домен вручну"
                      }
                      ariaLabel="Домен"
                    />
                  </Field>
                  <Field label="Ідентифікатор">
                    <div className="campaign-input-with-action">
                      <input
                        value={identifier}
                        readOnly={!manualIdentifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                      />
                      {manualIdentifier ? (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setManualIdentifier(false)}
                        >
                          <RotateCcw size={15} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setManualIdentifier(true)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </div>
                    {campaignUrl && (
                      <a
                        className="campaign-url"
                        href={campaignUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {campaignUrl}
                      </a>
                    )}
                  </Field>
                  <Field label="Джерело трафіку">
                    <InlineSearchSelect
                      items={sources}
                      value={sourceId}
                      onChange={setSourceId}
                      placeholder="Оберіть джерело"
                      ariaLabel="Джерело трафіку"
                    />
                  </Field>
                  <section className="campaign-pixel-block">
                    <header>
                      <strong>Піксель</strong>
                      <label>
                        <input
                          type="checkbox"
                          checked={manualPixel}
                          onChange={(event) =>
                            setManualPixel(event.target.checked)
                          }
                        />{" "}
                        Ввести вручну
                      </label>
                    </header>
                    {manualPixel ? (
                      <div className="campaign-fields-grid">
                        <Field label="Pixel ID">
                          <input
                            value={pixelId}
                            onChange={(event) => setPixelId(event.target.value)}
                          />
                        </Field>
                        <Field label="Токен">
                          <input
                            value={pixelToken}
                            onChange={(event) =>
                              setPixelToken(event.target.value)
                            }
                          />
                        </Field>
                      </div>
                    ) : (
                      <InlineSearchSelect
                        items={settings.pixels}
                        value={pixelKey}
                        onChange={setPixelKey}
                        getId={(item) => item.id}
                        getTitle={(item) => `${item.name} · ${item.pixelId}`}
                        getSearchText={(item) => `${item.name} ${item.pixelId}`}
                        placeholder="Оберіть піксель"
                        ariaLabel="Піксель"
                      />
                    )}
                  </section>
                </div>
              </section>
              <section className="campaign-workspace-column campaign-flow-column">
                <header>
                  <span className="eyebrow">White · позиція 1</span>
                  <h3>Налаштування потоків</h3>
                </header>
                <div className="campaign-flow-content">
                  <Field label="Шаблон оферів">
                    <InlineSearchSelect items={templates} value={templateId} onChange={setTemplateId} placeholder="Оберіть шаблон оферів" ariaLabel="Шаблон оферів" />
                  </Field>
                  <section className="campaign-white-settings"><h4>Налаштування White сторінки</h4><WhiteLandingSection landings={landings} groups={landingGroups} value={whiteLandings} onChange={setWhiteLandings} /></section>
                  <CountryExclusionSection
                    countries={countries}
                    value={excludedCountries}
                    onChange={setExcludedCountries}
                  />
                  <div className="campaign-fixed-settings">
                    <span>Ротація за позицією</span>
                    <span>
                      USD із <code>cost</code>
                    </span>
                    <span>IP + User-Agent</span>
                    <span>24 години · увімкнено</span>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
        <footer className="keitaro-campaign-foot">
          <span>
            {canCreate
              ? "Усі обов’язкові поля заповнені"
              : "Заповніть обов’язкові поля та оберіть лендінг"}
          </span>
          <div>
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Скасувати
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canCreate}
              onClick={create}
            >
              {creating && <LoaderCircle className="spin" size={16} />} Створити
              кампанію
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
