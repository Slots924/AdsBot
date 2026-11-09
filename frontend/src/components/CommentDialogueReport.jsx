const labels = { success: 'Опубліковано', failed: 'Помилка', unknown: 'Результат невідомий', skipped: 'Пропущено', pending: 'Не виконано' };

export default function CommentDialogueReport({ result }) {
    if (!result?.summary || !Array.isArray(result.rows)) return null;
    return <section className="comment-dialogue-report markdown-preview" aria-label="Звіт AU Comments">
        <p>{result.summaryText}</p>
        {result.stoppedForStorage && <p role="alert">Чергу зупинено через збій збереження. Перевірте історію перед повторним запуском.</p>}
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Рядок / батько</th><th>Дія</th><th>Профіль</th><th>Результат</th><th>Причина</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.id}>
            <td>{row.id}{row.parent_id != null ? ` / ${row.parent_id}` : ''}</td>
            <td>{row.type === 'reply' ? 'Реплай' : 'Коментар'}</td><td>{row.profileNo ? `№${row.profileNo}` : '—'}</td>
            <td>{row.status === 'success' && row.commentTarget?.commentUrl ? <a href={row.commentTarget.commentUrl} target="_blank" rel="noreferrer">{labels[row.status]}</a> : labels[row.status] || row.status}</td>
            <td>{row.counterWarning || row.storageWarning || row.message || '—'}</td>
        </tr>)}</tbody></table></div>
    </section>;
}
