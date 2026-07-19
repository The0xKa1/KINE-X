

const DEFAULT_CAPACITY = 15;

export class CoachHistory {
          buf                 = [];
          capacity        ;

  constructor(capacity         = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  push(pose              )       {
    this.buf.push(pose);
    if (this.buf.length > this.capacity) {
      this.buf.shift();
    }
  }

  getAll()                 {
    return this.buf;
  }

  reset()       {
    this.buf = [];
  }
}
