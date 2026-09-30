import { useEffect, useState } from "react";
import { api, type School, type SchoolClass } from "../api";
import { openLink } from "../max";

export default function ClassesScreen({
  classes,
  userId,
  onChange,
}: {
  classes: SchoolClass[];
  userId: number | null;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"list" | "create" | "import">("list");
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <div className="kv-card">
        <h3>Мои классы</h3>
        <p className="kv-muted">
          Класс — список учеников и родителей. Создайте его вручную или загрузите CSV/XLSX,
          укажите чат класса для публикаций и поделитесь доступом с другими учителями.
        </p>
        <div className="kv-actions">
          <button className="kv-btn primary" onClick={() => setMode(mode === "create" ? "list" : "create")}>
            Создать вручную
          </button>
          <button className="kv-btn" onClick={() => setMode(mode === "import" ? "list" : "import")}>
            Загрузить CSV/XLSX
          </button>
        </div>
      </div>

      {msg && <div className="kv-alert info">{msg}</div>}

      {mode === "create" && (
        <CreateClassForm
          userId={userId}
          onDone={(m) => {
            setMsg(m);
            setMode("list");
            onChange();
          }}
        />
      )}

      {mode === "import" && (
        <ImportClassForm
          userId={userId}
          onDone={(m) => {
            setMsg(m);
            setMode("list");
            onChange();
          }}
        />
      )}

      {!classes.length && <div className="kv-card">Классов пока нет.</div>}

      {classes.map((c) => (
        <div key={c.id} className="kv-card">
          <div className="kv-row">
            <h3>{c.title}</h3>
            <span className="kv-chip">{c.students.length} уч.</span>
          </div>
          <p className="kv-muted">
            {c.school_name || "Школа не указана"} · {c.teacher_name || "учитель не указан"}
            <br />
            Чат класса: {c.chat_id ? `указан (${c.chat_id})` : "не указан"}
          </p>
          <div className="kv-actions">
            <button className="kv-btn" onClick={() => setOpenedId(openedId === c.id ? null : c.id)}>
              {openedId === c.id ? "Свернуть" : "Открыть"}
            </button>
          </div>
          {openedId === c.id && (
            <ClassEditor klass={c} userId={userId} onChange={onChange} onMsg={setMsg} />
          )}
        </div>
      ))}
    </>
  );
}

function SchoolPicker({
  value,
  onSelect,
}: {
  value: number | null;
  onSelect: (school: School | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<School[]>([]);
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("Казань");

  useEffect(() => {
    api.schools(query || undefined).then(setSchools).catch(() => setSchools([]));
  }, [query]);

  async function createSchool() {
    if (!newName.trim()) return;
    const s = await api.createSchool({ name: newName.trim(), city: newCity });
    onSelect(s);
    setQuery("");
    setNewName("");
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="kv-filters">
        <input
          placeholder="Поиск школы по названию или номеру"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          value={value ?? ""}
          onChange={(e) => {
            const s = schools.find((x) => String(x.id) === e.target.value) ?? null;
            onSelect(s);
          }}
        >
          <option value="">Школа не выбрана</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.city})
            </option>
          ))}
        </select>
      </div>
      <div className="kv-filters" style={{ marginTop: 6 }}>
        <input placeholder="Или новая школа: название" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="Город" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
        <button className="kv-btn ghost" onClick={createSchool}>
          Добавить школу
        </button>
      </div>
    </div>
  );
}

function CreateClassForm({ userId, onDone }: { userId: number | null; onDone: (msg: string) => void }) {
  const [grade, setGrade] = useState("8");
  const [letter, setLetter] = useState("А");
  const [teacher, setTeacher] = useState("");
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const [studentsText, setStudentsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const students = studentsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, phone, parentName] = line.split(";").map((s) => s.trim());
        return { full_name: name, parent_phone: phone || "", parent_name: parentName || "" };
      });
    try {
      await api.createClass({
        grade,
        letter,
        teacher_name: teacher,
        school_id: schoolId,
        user_id: userId,
        students,
      });
      onDone(`Класс ${grade}${letter} создан (${students.length} уч.).`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kv-card" style={{ borderColor: "#6c4cf1" }}>
      <h3>Новый класс</h3>
      <div className="kv-filters">
        <input style={{ width: 60 }} placeholder="Параллель" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <input style={{ width: 60 }} placeholder="Литера" value={letter} onChange={(e) => setLetter(e.target.value)} />
        <input placeholder="ФИО учителя" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
      </div>
      <SchoolPicker value={schoolId} onSelect={(s) => setSchoolId(s?.id ?? null)} />
      <p className="kv-muted" style={{ marginTop: 8 }}>
        Ученики: по одному в строке в формате «ФИО; телефон родителя; ФИО родителя»
        (телефон и ФИО родителя необязательны).
      </p>
      <textarea
        rows={6}
        style={{ width: "100%" }}
        placeholder={"Иванов Иван Иванович; +79001234567; Иванова Мария\nПетров Пётр Петрович"}
        value={studentsText}
        onChange={(e) => setStudentsText(e.target.value)}
      />
      {err && <div className="kv-alert err">{err}</div>}
      <div className="kv-actions">
        <button className="kv-btn primary" disabled={busy || !grade.trim()} onClick={submit}>
          {busy ? "Создаём…" : "Создать класс"}
        </button>
      </div>
    </div>
  );
}

function ImportClassForm({ userId, onDone }: { userId: number | null; onDone: (msg: string) => void }) {
  const [grade, setGrade] = useState("8");
  const [letter, setLetter] = useState("А");
  const [teacher, setTeacher] = useState("");
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importClass(file, {
        grade,
        letter,
        teacher_name: teacher,
        school_id: schoolId,
        user_id: userId,
      });
      onDone(`Класс ${r.title} импортирован: ${r.students_created} уч.`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kv-card" style={{ borderColor: "#6c4cf1" }}>
      <h3>Импорт класса из файла</h3>
      <p className="kv-muted">
        CSV или XLSX с колонками «ФИО», «дата рождения», «телефон родителя», «ФИО родителя».
      </p>
      <div className="kv-filters">
        <input style={{ width: 60 }} placeholder="Параллель" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <input style={{ width: 60 }} placeholder="Литера" value={letter} onChange={(e) => setLetter(e.target.value)} />
        <input placeholder="ФИО учителя" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
      </div>
      <SchoolPicker value={schoolId} onSelect={(s) => setSchoolId(s?.id ?? null)} />
      <div className="kv-filters" style={{ marginTop: 8 }}>
        <input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {err && <div className="kv-alert err">{err}</div>}
      <div className="kv-actions">
        <button className="kv-btn primary" disabled={busy || !file} onClick={submit}>
          {busy ? "Импортируем…" : "Импортировать"}
        </button>
      </div>
    </div>
  );
}

function ClassEditor({
  klass,
  userId,
  onChange,
  onMsg,
}: {
  klass: SchoolClass;
  userId: number | null;
  onChange: () => void;
  onMsg: (msg: string) => void;
}) {
  const [teacher, setTeacher] = useState(klass.teacher_name);
  const [chatId, setChatId] = useState(klass.chat_id ? String(klass.chat_id) : "");
  const [schoolId, setSchoolId] = useState<number | null>(klass.school_id);
  const [newStudent, setNewStudent] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [shareUser, setShareUser] = useState("");
  const [shareRole, setShareRole] = useState<"EDIT" | "READ">("READ");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.updateClass(klass.id, {
        teacher_name: teacher,
        chat_id: chatId ? Number(chatId) : null,
        school_id: schoolId,
        user_id: userId,
      });
      onMsg("Класс сохранён.");
      onChange();
    } catch (e: any) {
      onMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function addStudent() {
    if (!newStudent.trim()) return;
    setBusy(true);
    try {
      await api.addStudent(klass.id, userId, { full_name: newStudent.trim(), parent_phone: newPhone.trim() });
      setNewStudent("");
      setNewPhone("");
      onMsg("Ученик добавлен, он включён во все выезды класса.");
      onChange();
    } catch (e: any) {
      onMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeStudent(studentId: number) {
    setBusy(true);
    try {
      await api.removeStudent(klass.id, studentId, userId);
      onMsg("Ученик удалён из класса.");
      onChange();
    } catch (e: any) {
      onMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const uid = Number(shareUser);
    if (!uid) return;
    setBusy(true);
    try {
      await api.shareClass(klass.id, userId, { user_id: uid, role: shareRole });
      onMsg(`Доступ выдан пользователю ${uid} (${shareRole === "EDIT" ? "редактирование" : "чтение"}).`);
    } catch (e: any) {
      onMsg(`Ошибка: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function inviteParent(studentId: number, studentName: string) {
    try {
      const r = await api.linkCode(studentId);
      onMsg(`Ссылка-приглашение для родителя (${studentName}): ${r.deep_link}`);
      openLink(r.deep_link);
    } catch (e: any) {
      onMsg(`Ошибка: ${e.message}`);
    }
  }

  if (!klass.can_edit) {
    return (
      <div style={{ marginTop: 10 }}>
        <p className="kv-muted">Доступ только для чтения. Список учеников:</p>
        <ul>
          {klass.students.map((s) => (
            <li key={s.id}>{s.full_name}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="kv-filters">
        <input placeholder="ФИО учителя" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
        <input
          placeholder="ID чата класса в MAX"
          value={chatId}
          onChange={(e) => setChatId(e.target.value.replace(/[^\d-]/g, ""))}
        />
        <button className="kv-btn primary" disabled={busy} onClick={save}>
          Сохранить
        </button>
      </div>
      <SchoolPicker value={schoolId} onSelect={(s) => setSchoolId(s?.id ?? null)} />

      <h3 style={{ marginTop: 12 }}>Ученики</h3>
      <table className="kv-table">
        <tbody>
          {klass.students.map((s) => (
            <tr key={s.id}>
              <td>
                {s.full_name}
                <div className="kv-muted">
                  {s.parents.length
                    ? s.parents
                        .map(
                          (p) =>
                            `${p.full_name}${p.bot_activated ? (p.confirmed ? " — подтверждён" : " — ждёт подтверждения") : " — бот не активирован"}`,
                        )
                        .join("; ")
                    : "родитель не указан"}
                </div>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="kv-btn ghost" onClick={() => inviteParent(s.id, s.full_name)}>
                  Пригласить родителя
                </button>
                <button className="kv-btn ghost" disabled={busy} onClick={() => removeStudent(s.id)}>
                  Удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="kv-filters" style={{ marginTop: 6 }}>
        <input placeholder="ФИО нового ученика" value={newStudent} onChange={(e) => setNewStudent(e.target.value)} />
        <input placeholder="Телефон родителя" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
        <button className="kv-btn" disabled={busy || !newStudent.trim()} onClick={addStudent}>
          Добавить ученика
        </button>
      </div>

      <h3 style={{ marginTop: 12 }}>Доступ других учителей</h3>
      <div className="kv-filters">
        <input placeholder="MAX user_id учителя" value={shareUser} onChange={(e) => setShareUser(e.target.value)} />
        <select value={shareRole} onChange={(e) => setShareRole(e.target.value as "EDIT" | "READ")}>
          <option value="READ">Чтение</option>
          <option value="EDIT">Редактирование</option>
        </select>
        <button className="kv-btn" disabled={busy || !shareUser} onClick={share}>
          Поделиться классом
        </button>
      </div>
    </div>
  );
}
