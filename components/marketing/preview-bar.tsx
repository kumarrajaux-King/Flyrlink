import { Container } from '../ui/container';

/** Discloses, once and up front, that this is a preview with labelled sample content. */
export function PreviewBar() {
  return (
    <div className="bg-brand-50 text-brand-700">
      <Container className="flex min-h-9 items-center justify-center gap-2.5 py-1.5 text-center text-[12.5px]">
        <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-white uppercase">
          Preview
        </span>
        <span>
          Home Page preview — sample profiles and figures are labelled; AI analysis runs locally.
        </span>
      </Container>
    </div>
  );
}
