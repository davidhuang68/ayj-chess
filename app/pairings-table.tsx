"use client";
import type { Round, Result } from "@/lib/chess";
export default function PairingsTable({
  round,
  names,
  preview = false,
  pending,
  editable,
  onResult,
  display = false,
  deletedPlayerIds = [],
}: {
  round: Round;
  names: Record<string, string>;
  preview?: boolean;
  pending: boolean;
  editable: boolean;
  onResult: (gameId: string, result: Result) => void;
  display?: boolean;
  deletedPlayerIds?: string[];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Board</th>
            <th>White</th>
            <th>Black</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {round.games.map((game) => (
            <tr key={game.id}>
              <td>{game.board}</td>
              <td>{names[game.white]}</td>
              <td>{game.black ? names[game.black] : "Bye"}</td>
              <td>
                {!game.black ? (
                  "1 point"
                ) : preview ? (
                  "—"
                ) : (
                  <div className="results">
                    {(
                      [
                        ["white", "1–0"],
                        ["draw", "½–½"],
                        ["black", "0–1"],
                      ] as [Result, string][]
                    ).map(([result, label]) => (
                      <button
                        key={result}
                        aria-label={`Board ${game.board}: ${label}`}
                        aria-pressed={game.result === result}
                        disabled={pending || !editable || deletedPlayerIds.includes(game.white) || deletedPlayerIds.includes(game.black!)}
                        onClick={() => onResult(game.id, result)}
                      >
                        {label}
                      </button>
                    ))}
                    {!display && (
                      <select
                        aria-label={`Board ${game.board}: other result`}
                        value={
                          game.result &&
                          ["forfeit-white", "forfeit-black"].includes(
                            game.result,
                          )
                            ? game.result
                            : "other"
                        }
                        disabled={pending || !editable || deletedPlayerIds.includes(game.white) || deletedPlayerIds.includes(game.black!)}
                        onChange={(e) =>
                          onResult(game.id, (e.target.value || null) as Result)
                        }
                      >
                        <option value="other" disabled>
                          Other
                        </option>
                        <option value="">Clear result</option>
                        <option value="forfeit-white">White by forfeit</option>
                        <option value="forfeit-black">Black by forfeit</option>
                      </select>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
