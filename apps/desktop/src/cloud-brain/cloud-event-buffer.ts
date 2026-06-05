const MAX_BUFFER_SIZE = 50;
const buffer: string[] = [];

export function createEventBuffer() {
  return {
    push(event: string): void {
      if (buffer.length >= MAX_BUFFER_SIZE) {
        buffer.shift();
      }
      buffer.push(event);
    },

    drain(): string[] {
      const events = [...buffer];
      buffer.length = 0;
      return events;
    },

    size(): number {
      return buffer.length;
    },
  };
}
