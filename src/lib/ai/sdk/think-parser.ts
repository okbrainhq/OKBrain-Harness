/**
 * Streaming parser that separates <think>...</think> blocks from visible text.
 * Handles tags split across chunk boundaries.
 */
export class ThinkTagParser {
  private inThinkBlock = false;
  private buffer = '';

  process(chunk: string): { text: string; thought: string } {
    this.buffer += chunk;
    let text = '';
    let thought = '';

    while (this.buffer.length > 0) {
      if (this.inThinkBlock) {
        const endIdx = this.buffer.indexOf('</think>');
        if (endIdx !== -1) {
          thought += this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + '</think>'.length);
          this.inThinkBlock = false;
        } else {
          const partial = this.findPartialSuffix(this.buffer, '</think>');
          if (partial > 0) {
            thought += this.buffer.slice(0, this.buffer.length - partial);
            this.buffer = this.buffer.slice(this.buffer.length - partial);
          } else {
            thought += this.buffer;
            this.buffer = '';
          }
          break;
        }
      } else {
        const startIdx = this.buffer.indexOf('<think>');
        if (startIdx !== -1) {
          text += this.buffer.slice(0, startIdx);
          this.buffer = this.buffer.slice(startIdx + '<think>'.length);
          this.inThinkBlock = true;
        } else {
          const partial = this.findPartialSuffix(this.buffer, '<think>');
          if (partial > 0) {
            text += this.buffer.slice(0, this.buffer.length - partial);
            this.buffer = this.buffer.slice(this.buffer.length - partial);
          } else {
            text += this.buffer;
            this.buffer = '';
          }
          break;
        }
      }
    }

    return { text, thought };
  }

  flush(): { text: string; thought: string } {
    const remaining = this.buffer;
    this.buffer = '';
    if (this.inThinkBlock) {
      return { text: '', thought: remaining };
    }
    return { text: remaining, thought: '' };
  }

  private findPartialSuffix(text: string, tag: string): number {
    for (let i = 1; i < tag.length; i++) {
      if (text.endsWith(tag.slice(0, i))) {
        return i;
      }
    }
    return 0;
  }
}
