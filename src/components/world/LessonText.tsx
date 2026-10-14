import { Fragment } from "react";
import type { LessonBlock, LessonInline } from "@/lib/world/lesson-text";
import u from "@/components/world/world-ui.module.css";

/**
 * A lesson's written text on the lesson page: the blocks lesson-text.ts read
 * out of the row's `description`, drawn as React elements and nothing else.
 * No HTML from the text is ever interpreted: every string below reaches the
 * page as text. A link is only ever one lesson-text.ts let through (https),
 * and it opens in a new tab with no opener and no referrer.
 *
 * The caller parses, so it can tell "there is text" from "there is none"
 * before deciding what goes in the video's place (LessonScreen).
 */
export function LessonText({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div className={u.text}>
      {blocks.map((block, i) => {
        if (block.kind === "bullets") {
          return (
            <ul key={i}>
              {block.items.map((runs, j) => (
                <li key={j}>
                  <Runs runs={runs} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "numbered") {
          // The numbers as written: the list starts at the first one, and each
          // item carries its own, so 3, 4, 5 stays 3, 4, 5 and so does 1, 7, 2.
          return (
            <ol key={i} start={block.items[0]?.n}>
              {block.items.map((item, j) => (
                <li key={j} value={item.n}>
                  <Runs runs={item.runs} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((runs, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Runs runs={runs} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Runs({ runs }: { runs: LessonInline[] }) {
  return runs.map((run, i) => {
    const content =
      run.kind === "link" ? (
        <a href={run.href} target="_blank" rel="noopener noreferrer">
          {run.text}
        </a>
      ) : (
        run.text
      );
    return run.bold ? <strong key={i}>{content}</strong> : <Fragment key={i}>{content}</Fragment>;
  });
}
