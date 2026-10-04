import { CreditCard, LoaderCircle } from "lucide-react";

export default function PersonalPaymentSources({ result, loading = false, error = "" }) {
    const sources = result?.sources ?? [];
    const state = !result ? "unchecked" : sources.length ? "present" : "empty";
    const message = state === "unchecked" ? "Дані ще не перевірено"
        : state === "empty" ? "Перевірено — Meta не повернула спосіб оплати"
            : "Способи оплати, які повернула Meta";
    const visibleSources = sources.length ? sources : [null];

    return <section className="personal-payment-sources" aria-label="Способи оплати рекламного акаунта" data-state={state}>
        <div className="personal-payment-sources-heading"><h4>{sources.length > 1 ? "Способи оплати" : "Поточний спосіб оплати"}</h4>
            <span role="status">{loading ? <><LoaderCircle className="spin" size={15} /> Перевірка способів оплати…</> : message}</span>
        </div>
        {error && <p className="personal-payment-sources-warning" role="alert">Не вдалося перевірити способи оплати: {error}{result ? ". Показано результат попередньої перевірки." : ""}</p>}
        {state === "empty" && result.accountStatus != null && result.accountStatus !== 1 && <p className="personal-payment-sources-note">Рекламний акаунт неактивний. Meta може не повертати його платіжні дані.</p>}
        <div className="personal-payment-source-list">
            {visibleSources.map((source, index) => <article className={`credit-card-tile personal-payment-source${source ? "" : " placeholder"}`} key={source?.id ?? index}>
                <div className="credit-card-top"><span>{source ? "Отримано з Meta" : state === "empty" ? "Даних немає" : "Не перевірено"}</span><strong>{source?.network || "—"}</strong></div>
                <CreditCard className="credit-card-chip" size={34} />
                <div className="credit-card-number">{source?.last4 ? `•••• ${source.last4}` : source?.displayString || "•••• ————"}</div>
                <div className="personal-payment-source-id"><span>Джерело оплати</span><strong>{source?.id || "—"}</strong></div>
            </article>)}
        </div>
    </section>;
}
