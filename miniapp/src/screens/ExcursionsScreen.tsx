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
        <h3>Пока нет выездов</h3>
        <p className="kv-muted">Создайте первый выезд во вкладке «Каталог событий».</p>
      </div>
    );
  }
  return (
    <div className="kv-card">
      <h3>Мои выезды</h3>
      <table className="kv-table">
        <thead>
          <tr>
            <th>Событие</th>
            <th>Дата</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {excursions.map((e) => (
            <tr
              key={e.id}
              onClick={() => onSelect(e.id)}
              style={{ cursor: "pointer", background: e.id === activeId ? "#f6f4ff" : undefined }}
            >
              <td>
                <b>{e.title}</b>
                <div className="kv-muted">{e.location_name}</div>
              </td>
              <td>{e.event_date ?? "—"}</td>
              <td>{e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
