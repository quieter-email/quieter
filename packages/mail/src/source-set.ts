type ImageCandidate = {
  descriptor: string;
  source: string;
};

export const parseImageSourceSet = (sourceSet: string): ImageCandidate[] => {
  const candidates: ImageCandidate[] = [];
  let position = 0;
  while (position < sourceSet.length) {
    while (
      position < sourceSet.length &&
      /[\s,]/u.test(sourceSet.charAt(position))
    ) {
      position += 1;
    }
    const start = position;
    while (
      position < sourceSet.length &&
      !/\s/u.test(sourceSet.charAt(position))
    ) {
      position += 1;
    }
    if (start === position) {
      break;
    }
    let end = position;
    while (end > start && sourceSet.charAt(end - 1) === ",") {
      end -= 1;
    }
    let descriptor = "";
    if (end === position) {
      const descriptorStart = position;
      while (
        position < sourceSet.length &&
        sourceSet.charAt(position) !== ","
      ) {
        position += 1;
      }
      descriptor = sourceSet.slice(descriptorStart, position).trim();
      position += 1;
      if (descriptor !== "" && !/^(?:\d+w|(?:\d*\.)?\d+x)$/u.test(descriptor)) {
        return [];
      }
    }
    candidates.push({ descriptor, source: sourceSet.slice(start, end) });
  }
  return candidates;
};
