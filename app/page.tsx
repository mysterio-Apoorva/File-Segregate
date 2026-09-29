import { Library } from "@/components/library";
import Link from "next/link";
import {
  BookOpen,
  ArrowUpRight,
  Layers3,
  ScanText,
  FolderTree,
  Download,
} from "lucide-react";
export default function Home() {
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="StudySort AI home">
          <span className="brand-icon">
            <BookOpen size={21} />
          </span>
          StudySort<span className="brand-ai">AI</span>
        </Link>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="#workspace" className="nav-cta">
            Open workspace <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="green-dot" /> A LITTLE ORDER. A LOT MORE CLARITY.
            </div>
            <h1>
              Turn a messy folder into an <em>organized knowledge library.</em>
            </h1>
            <p>
              Upload your study material. Gemini understands the content and
              automatically organizes it by subject, chapter, and topic.
            </p>
            <a className="button primary hero-cta" href="#workspace">
              Start organizing <ArrowUpRight size={18} />
            </a>
            <div className="hero-note">
              No account needed <span>·</span> Your originals stay intact
            </div>
          </div>
          <div
            className="hero-visual"
            aria-label="Loose documents become subjects, chapters, topics and an organized ZIP"
          >
            <div className="visual-label">FROM SCATTERED TO SORTED</div>
            <div className="loose-files">
              <span className="paper paper-one">
                PDF<span>notes_final_2</span>
                <i />
                <i />
                <i />
              </span>
              <span className="paper paper-two">
                PPTX<span>lecture_07</span>
                <i />
                <i />
                <i />
              </span>
              <span className="paper paper-three">
                DOCX<span>untitled_copy</span>
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="flow-line">
              <span />
              <span className="gemini-mark">✦</span>
              <span />
            </div>
            <div className="organized-card">
              <div className="organized-title">
                <FolderTree size={18} />
                <strong>Your knowledge, connected</strong>
                <span className="small-tag">SORTED</span>
              </div>
              <div className="visual-tree">
                <div>
                  <span className="folder-symbol" /> Subjects{" "}
                  <span>discovered from content</span>
                </div>
                <div className="indent">
                  <span className="folder-symbol" /> Chapters
                </div>
                <div className="indent deeper">
                  <span className="folder-symbol" /> Topics & original files
                </div>
              </div>
              <div className="visual-footer">
                <Download size={14} /> One organized ZIP. Ready for your next
                session.
              </div>
            </div>
          </div>
        </section>
        <section className="principles" id="how-it-works">
          <div>
            <ScanText size={22} />
            <span>
              <strong>Reads beyond the filename</strong>
              <small>Actual content. Meaningful categories.</small>
            </span>
          </div>
          <div>
            <Layers3 size={22} />
            <span>
              <strong>Finds the overlap</strong>
              <small>Spot duplicates. Keep every original.</small>
            </span>
          </div>
          <div>
            <FolderTree size={22} />
            <span>
              <strong>A structure that makes sense</strong>
              <small>Your subjects, chapters, and topics.</small>
            </span>
          </div>
        </section>
        <Library />
        <section className="privacy-note">
          <BookOpen size={19} />
          <p>
            <strong>Your material, handled thoughtfully.</strong> Files are
            private to this browser session. Content is sent to Google Gemini
            for analysis. Sessions expire after 24 hours; scheduled cleanup
            removes stored files afterward. Download your library before it
            expires.
          </p>
        </section>
      </main>
      <footer>
        <Link className="brand" href="/">
          StudySort<span className="brand-ai">AI</span>
        </Link>
        <span>Less sorting. More learning.</span>
        <span>Powered by Google Gemini</span>
      </footer>
    </>
  );
}
