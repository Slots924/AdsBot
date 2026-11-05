const reactionTypes = [
    ["LIKE", "👍", "Подобається"],
    ["LOVE", "❤️", "Любов"],
    ["CARE", "🥰", "Турбота"],
    ["HAHA", "😆", "Ха-ха"],
    ["WOW", "😮", "Ого"],
    ["SAD", "😢", "Сум"],
    ["ANGRY", "😡", "Злість"],
];

export default function ReactionCounts({ counts, total }) {
    const visible = reactionTypes
        .filter(([type]) => Number(counts?.[type]) > 0)
        .sort(([left], [right]) => Number(counts[right]) - Number(counts[left]));
    const formattedTotal = total == null ? "—" : Number(total).toLocaleString("uk-UA");
    return <span className="reaction-counts" role="group" aria-label="Реакції">
        {visible.length ? visible.map(([type, emoji, label]) => {
            const value = Number(counts[type]).toLocaleString("uk-UA");
            return <span className="reaction-count" key={type} title={`${label}: ${value}`} aria-label={`${label}: ${value}`}>
                <span aria-hidden="true">{emoji}</span><span aria-hidden="true">{value}</span>
            </span>;
        }) : <span>{formattedTotal} реакцій</span>}
    </span>;
}
