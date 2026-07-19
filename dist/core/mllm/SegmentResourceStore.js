












export class SegmentResourceStore {
          resources                    = [];
          sourceUrl                = null;

  replace(file      , result                             , thumbnails                     )                    {
    this.clear();
    this.sourceUrl = URL.createObjectURL(file);
    this.resources = result.segments.map((segment) => ({
      id: segment.id,
      sourceFile: file,
      sourceUrl: this.sourceUrl ,
      thumbnail: thumbnails.get(segment.id) ?? "",
      status: "ready",
      segment,
      summary: result.summary,
      globalTags: result.globalTags,
    }));
    return this.all();
  }

  all()                    {
    return [...this.resources];
  }

  get(id        )                         {
    return this.resources.find((item) => item.id === id) ?? null;
  }

  clear()       {
    if (this.sourceUrl) {
      URL.revokeObjectURL(this.sourceUrl);
      this.sourceUrl = null;
    }
    this.resources = [];
  }
}
