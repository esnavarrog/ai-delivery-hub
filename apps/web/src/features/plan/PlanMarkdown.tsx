import Markdown from 'react-markdown';

/** Read-only rendering of the server-side `renderedMarkdown`, for copy/paste and quick reading. */
export function PlanMarkdown({ markdown }: { markdown: string }) {
  if (markdown.trim().length === 0) return <p className="text-sm text-muted-foreground">This version has no rendered markdown.</p>;
  return (
    <article className="prose-sm max-w-none rounded-xl border bg-card p-4 sm:p-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5" data-testid="plan-markdown">
      <Markdown>{markdown}</Markdown>
    </article>
  );
}
