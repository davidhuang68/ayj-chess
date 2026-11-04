"use client";
import { useMemo, useState, type FormEvent } from "react";
import {
  normalName,
  parseCSV,
  parseNames,
  parsePlayerImport,
  type InitialRatingInput,
  type Club,
} from "@/lib/chess";
type Mode = "new" | "existing";
export default function PlayerImports({
  club,
  pending,
  onImport,
}: {
  club: Club;
  pending: boolean;
  onImport: (text: string, mode: Mode, initialRatings?:InitialRatingInput[]) => Promise<boolean>;
}) {
  const [newText, setNewText] = useState(""),
    [ratings,setRatings]=useState<Map<string,string>>(()=>new Map()),
    [existingText, setExistingText] = useState(""),
    [csvRows, setCsvRows] = useState<string[][]>([]),
    [column, setColumn] = useState(0),
    [csvError, setCsvError] = useState("");
  const preview = (text: string, mode: Mode) => {
    try {
      return { ...parsePlayerImport(club, text, mode), error: "" };
    } catch (e) {
      return {
        names: [],
        duplicates: 0,
        error: e instanceof Error ? e.message : "Invalid names.",
      };
    }
  };
  const fresh = useMemo(() => preview(newText, "new"), [club, newText]),
    existing = useMemo(
      () => preview(existingText, "existing"),
      [club, existingText],
    );
  const split = (text: string) => {
    const names = parseNames(text).names,
      known = new Set(club.players.map((p) => normalName(p.name)));
    setNewText(names.filter((n) => !known.has(normalName(n))).join("\n"));
    setExistingText(names.filter((n) => known.has(normalName(n))).join("\n"));
  };
  const loadCSV = async (file: File) => {
    setCsvError("");
    try {
      if (file.size > 1000000) throw new Error("CSV must be under 1 MB.");
      const rows = parseCSV(await file.text());
      if (rows.length < 2) throw new Error("CSV needs a header and names.");
      const c = Math.max(
        0,
        rows[0].findIndex((x) =>
          /^(name|full name|student name|player name)$/i.test(x),
        ),
      );
      split(
        rows
          .slice(1)
          .map((r) => r[c] ?? "")
          .join("\n"),
      );
      setColumn(c);
      setCsvRows(rows);
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : "Could not import CSV.");
    }
  };
  const submit = async (e: FormEvent, mode: Mode) => {
    e.preventDefault();
    const initialRatings=mode==='new'?fresh.names.flatMap(name=>{
      const value=ratings.get(normalName(name))?.trim();
      return value?[{name,rating:Number(value)}]:[];
    }):undefined;
    if (await onImport(mode === "new" ? newText : existingText, mode,initialRatings)) {
      if (mode === "new") {setNewText("");setRatings(new Map());}
      else setExistingText("");
      setCsvRows([]);
    }
  };
  return (
    <div className="player-imports">
      <form onSubmit={(e) => void submit(e, "new")}>
        <label htmlFor="new-players">New players</label>
        <textarea
          id="new-players"
          placeholder="One name per line"
          rows={4}
          maxLength={30000}
          value={newText}
          disabled={pending}
          onChange={(e) => {
            setNewText(e.target.value);
            setCsvRows([]);
          }}
        />
        {fresh.names.length>0&&!fresh.error&&(
          <div className="new-player-ratings">
            <table>
              <thead><tr><th>Name</th><th>Starting rating</th></tr></thead>
              <tbody>
                {fresh.names.map(name=><tr key={normalName(name)}>
                  <td>{name}</td>
                  <td><input type="number" min="100" max="3500" step="1" disabled={pending}
                    aria-label={`Starting rating for ${name}`}
                    placeholder={String(club.startingRating)}
                    value={ratings.get(normalName(name))??''}
                    onChange={event=>{const value=event.target.value;setRatings(current=>new Map(current).set(normalName(name),value));}}
                  /></td>
                </tr>)}
              </tbody>
            </table>
            <small>Blank = {club.startingRating}</small>
          </div>
        )}
        {fresh.error && (
          <p role="alert" className="error import-error">
            {fresh.error}
          </p>
        )}
        {fresh.duplicates > 0 && (
          <small>{fresh.duplicates} duplicates skipped</small>
        )}
        <button
          className="primary"
          disabled={pending || !fresh.names.length || !!fresh.error}
        >
          Add new players
        </button>
      </form>
      <form onSubmit={(e) => void submit(e, "existing")}>
        <label htmlFor="existing-players">Existing players</label>
        <textarea
          id="existing-players"
          placeholder="One name per line"
          rows={4}
          maxLength={30000}
          value={existingText}
          disabled={pending}
          onChange={(e) => {
            setExistingText(e.target.value);
            setCsvRows([]);
          }}
        />
        {existing.error && (
          <p role="alert" className="error import-error">
            {existing.error}
          </p>
        )}
        {existing.duplicates > 0 && (
          <small>{existing.duplicates} duplicates skipped</small>
        )}
        <button
          className="primary"
          disabled={pending || !existing.names.length || !!existing.error}
        >
          Add existing players
        </button>
      </form>
      <label className="file-button">
        Import CSV
        <input
          type="file"
          disabled={pending}
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadCSV(file);
            e.target.value = "";
          }}
        />
      </label>
      {csvRows.length > 0 && (
        <label>
          Name column
          <select
            value={column}
            disabled={pending}
            onChange={(e) => {
              const c = Number(e.target.value);
              try {
                split(
                  csvRows
                    .slice(1)
                    .map((r) => r[c] ?? "")
                    .join("\n"),
                );
                setColumn(c);
                setCsvError("");
              } catch (e) {
                setCsvError(e instanceof Error ? e.message : "Invalid names.");
              }
            }}
          >
            {csvRows[0].map((heading, i) => (
              <option value={i} key={i}>
                {heading || `Column ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {csvError && (
        <p className="error import-error" role="alert">
          {csvError}
        </p>
      )}
    </div>
  );
}
