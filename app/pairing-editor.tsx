"use client";
import { useMemo, useState, type FormEvent } from "react";
import type { Round, Tournament } from "@/lib/chess";
import {
  gamePlayers,
  replacePendingPairings,
  resultLocked,
  type EditablePair,
} from "@/lib/round-editing";

type Row = EditablePair & { key: string; board?: number };
export default function PairingEditor({
  event,
  previousSessions,
  round,
  names,
  pending,
  onSave,
  onCancel,
}: {
  event: Tournament;
  previousSessions: Tournament[];
  round: Round;
  names: Record<string, string>;
  pending: boolean;
  onSave: (pairs: EditablePair[], allowRematches: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const locked = useMemo(
    () => new Set(round.games.filter(resultLocked).flatMap(gamePlayers)),
    [round],
  );
  const eligible = useMemo(
    () =>
      (round.eligiblePlayers ?? event.roster)
        .filter((id) => event.roster.includes(id) && !event.withdrawn.includes(id) && !locked.has(id))
        .sort((a, b) => names[a].localeCompare(names[b])),
    [event, round, names, locked],
  );
  const [rows, setRows] = useState<Row[]>(() =>
      round.games
        .filter(
          (game) =>
            !resultLocked(game) &&
            gamePlayers(game).every((id) => eligible.includes(id)),
        )
        .map((game) => ({
          key: game.id,
          id: game.id,
          board: game.board,
          white: game.white,
          black: game.black,
        })),
    ),
    [allowRematches, setAllowRematches] = useState(false),
    [error, setError] = useState("");
  const used = new Set(
    rows.flatMap((row) => [row.white, row.black].filter(Boolean)),
  );
  const waiting = eligible.filter((id) => !used.has(id));
  const change = (key: string, side: "white" | "black", id: string) => {
    setError("");
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? { ...row, [side]: side === "black" && !id ? null : id }
          : row,
      ),
    );
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const pairs = rows.map(({ id, white, black }) => ({
      ...(id ? { id } : {}),
      white,
      black,
    }));
    try {
      if (pairs.some((pair) => !pair.white))
        throw new Error("Choose White or remove the board.");
      replacePendingPairings(
        event,
        structuredClone(round),
        pairs,
        allowRematches,
        previousSessions,
      );
      await onSave(pairs, allowRematches);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save pairings.");
    }
  };
  return (
    <form className="pairing-editor" onSubmit={submit}>
      <h3>Edit unplayed boards</h3>
      {locked.size > 0 && <small>Recorded games are locked.</small>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Board</th>
              <th>White</th>
              <th>Black</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key}>
                <td>{row.board ?? "New"}</td>
                <td>
                  <select
                    aria-label={`White pairing ${i + 1}`}
                    value={row.white}
                    disabled={pending}
                    onChange={(e) => change(row.key, "white", e.target.value)}
                  >
                    <option value="">Select player</option>
                    {eligible.map((id) => (
                      <option key={id} value={id}>
                        {names[id]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`Black pairing ${i + 1}`}
                    value={row.black ?? ""}
                    disabled={pending}
                    onChange={(e) => change(row.key, "black", e.target.value)}
                  >
                    <option value="">Bye</option>
                    {eligible.map((id) => (
                      <option key={id} value={id}>
                        {names[id]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={pending || !row.black || !row.white}
                      aria-label={`Swap colours pairing ${i + 1}`}
                      onClick={() =>
                        setRows((current) =>
                          current.map((pair) =>
                            pair.key === row.key
                              ? {
                                  ...pair,
                                  white: pair.black!,
                                  black: pair.white,
                                }
                              : pair,
                          ),
                        )
                      }
                    >
                      Swap colours
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Remove pairing ${i + 1}`}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((pair) => pair.key !== row.key),
                        )
                      }
                    >
                      Remove board
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {waiting.length > 0 && (
        <p className="waiting" role="status">
          Waiting: {waiting.map((id) => names[id]).join(", ")}
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={allowRematches}
          disabled={pending}
          onChange={(e) => setAllowRematches(e.target.checked)}
        />
        Allow rematches
      </label>
      <div className="actions">
        <button
          type="button"
          disabled={pending || !waiting.length}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                white: waiting[0],
                black: waiting[1] ?? null,
              },
            ])
          }
        >
          Add board
        </button>
        <button className="primary" disabled={pending}>
          Save pairings
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          Cancel edits
        </button>
      </div>
    </form>
  );
}
