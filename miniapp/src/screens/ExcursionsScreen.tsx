import type { Excursion } from "../api";

export default function ExcursionsScreen({
  excursions,
  activeId,
  onSelect,
}: {
  excursions: Excursion[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  if (!excursions.length) {
    return (
      <div className="kv-card">
        <p className="kv-section">Журнал выездов</p>
        <p className="kv-muted">Записей нет. Создайте первый выезд во вкладке «Каталог событий».</p>
      </div>
    );
  }
  return (
    <div className="kv-card">
      <p className="kv-section">Журнал выездов · {excursions.length}</p>
      <table className="kv-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}>№</th>
            <th>Мероприятие</th>
            <th>Дата</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {excursions.map((e, i) => (
            <tr
              key={e.id}
              onClick={() => onSelect(e.id)}
              style={{ cursor: "pointer", background: e.id === activeId ? "#fafbfa" : undefined }}
            >
              <td className="kv-num">{i + 1}</td>
              <td>
                <b>{e.title}</b>
                <div className="kv-muted">{e.location_name}</div>
              </td>
              <td className="kv-data">{e.event_date ?? "—"}</td>
              <td className="kv-muted">{e.status === "VOTING" ? "сбор ответов" : e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
