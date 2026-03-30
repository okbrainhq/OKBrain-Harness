export class FunctionCallTagSanitizer {
  private static readonly START_TAG = '<function_call>';
  private static readonly END_TAG = '</function_call>';
  private buffer = '';

  process(chunk: string): string {
    this.buffer += chunk;
    return this.drain(false);
  }

  flush(): string {
    return this.drain(true);
  }

  private drain(flush: boolean): string {
    let output = '';

    while (this.buffer.length > 0) {
      const startIndex = this.buffer.indexOf(FunctionCallTagSanitizer.START_TAG);

      if (startIndex === -1) {
        if (flush) {
          output += this.buffer;
          this.buffer = '';
        } else {
          // Keep a tail to detect an opening tag split across chunk boundaries.
          const keepTail = Math.min(this.buffer.length, FunctionCallTagSanitizer.START_TAG.length - 1);
          if (this.buffer.length > keepTail) {
            output += this.buffer.slice(0, this.buffer.length - keepTail);
            this.buffer = this.buffer.slice(this.buffer.length - keepTail);
          }
        }
        break;
      }

      if (startIndex > 0) {
        output += this.buffer.slice(0, startIndex);
        this.buffer = this.buffer.slice(startIndex);
      }

      const endIndex = this.buffer.indexOf(
        FunctionCallTagSanitizer.END_TAG,
        FunctionCallTagSanitizer.START_TAG.length
      );

      if (endIndex === -1) {
        if (flush) {
          // Drop a dangling/incomplete function call block.
          this.buffer = '';
        }
        break;
      }

      this.buffer = this.buffer.slice(endIndex + FunctionCallTagSanitizer.END_TAG.length);
    }

    return output;
  }
}
