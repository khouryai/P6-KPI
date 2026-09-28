import React from 'react';
import { href } from '../router';

/**
 * One screen failing should not take the window with it.
 *
 * Without this, a render throw anywhere unmounts the whole tree: the window goes
 * white, the nav goes with it, and there is no way back but a reload — which on
 * unsaved work is the expensive kind of mistake. The boundary keeps the sidebar and
 * the status strip alive, says which screen failed and what it said, and offers the
 * two things that actually recover it.
 *
 * It deliberately does not swallow the error. It is printed to the console with the
 * component stack, because the alternative is a class of bug that can only ever be
 * reported as "it went blank".
 */
type Props = { screen: string; children: React.ReactNode };
type State = { error: Error | null };

export class Boundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[T&C] ${this.props.screen} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Leaving the screen clears it, so a bad screen does not poison the next one.
    if (prev.screen !== this.props.screen && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-8">
        <div className="notice notice-error">
          <div className="font-semibold">This screen could not be drawn.</div>
          <p className="mt-1 text-[12.5px]">
            Nothing has been lost: what is in the folder is untouched, and every other screen still works. If it happens again, the message below is
            the useful part of a bug report.
          </p>
          <pre className="mono mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-[11.5px] whitespace-pre-wrap">{error.message}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-mini btn-primary" onClick={() => this.setState({ error: null })}>
              Try this screen again
            </button>
            <a className="btn btn-mini" href={href('dashboard')} onClick={() => this.setState({ error: null })}>
              Go to the Dashboard
            </a>
            <button className="btn btn-mini" onClick={() => window.location.reload()}>
              Reload the application
            </button>
          </div>
        </div>
      </div>
    );
  }
}
