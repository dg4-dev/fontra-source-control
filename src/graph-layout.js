// Lays out a commit graph in lanes, like the Git Graph extension for VS Code.
//
// Commits must come children first (git log --date-order or --topo-order).
// Each row gets the commit's lane and the line segments to draw in its upper
// half (from the row above down to the commit's dot) and lower half (from the
// dot down to the row below). Lanes are columns; a lane keeps its column for
// its whole life, and freed columns are reused.

// Returns { rows, laneCount } with rows[i] = {
//   hash, lane, color,
//   top:    { from, to, color }[]   lanes at the top edge → lanes at the dot
//   bottom: { from, to, color }[]   lanes at the dot → lanes at the bottom edge
// }
export function layoutGraph(commits) {
  // lanes[i] = { hash expected next in this lane, color } or null
  const lanes = [];
  const rows = [];
  let nextColor = 0;
  let laneCount = 0;

  const freeLane = () => {
    const index = lanes.indexOf(null);
    return index >= 0 ? index : lanes.length;
  };

  for (const commit of commits) {
    // Lanes coming into this commit from above (its children)
    const incoming = [];
    lanes.forEach((lane, index) => {
      if (lane && lane.hash === commit.hash) {
        incoming.push(index);
      }
    });

    let lane;
    let color;
    if (incoming.length) {
      lane = incoming[0];
      color = lanes[lane].color;
    } else {
      // A branch tip: nothing above leads here
      lane = freeLane();
      color = nextColor++;
    }

    const top = [];
    lanes.forEach((entry, index) => {
      if (!entry) {
        return;
      }
      if (entry.hash === commit.hash) {
        top.push({ from: index, to: lane, color: entry.color });
      } else {
        top.push({ from: index, to: index, color: entry.color });
      }
    });

    // Lanes that merged into this commit end here
    for (const index of incoming) {
      lanes[index] = null;
    }

    const bottom = [];
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent !== undefined) {
      lanes[lane] = { hash: firstParent, color };
    } else {
      lanes[lane] = null;
    }
    const edgesFromDot = [];
    if (firstParent !== undefined) {
      edgesFromDot.push({ from: lane, to: lane, color });
    }
    for (const parent of otherParents) {
      let target = lanes.findIndex((entry) => entry && entry.hash === parent);
      let parentColor;
      if (target >= 0) {
        // Joins a lane that already leads to this parent
        parentColor = lanes[target].color;
      } else {
        target = freeLane();
        parentColor = nextColor++;
        lanes[target] = { hash: parent, color: parentColor };
      }
      edgesFromDot.push({ from: lane, to: target, color: parentColor });
    }

    // Lanes that passed by the dot (not ending at it) continue straight down
    const passing = new Set(
      top
        .filter((edge) => edge.from === edge.to && !incoming.includes(edge.from))
        .map((edge) => edge.from)
    );
    lanes.forEach((entry, index) => {
      if (entry && index !== lane && passing.has(index)) {
        bottom.push({ from: index, to: index, color: entry.color });
      }
    });
    bottom.push(...edgesFromDot);

    // Trim trailing empty lanes so columns are reused from the right
    while (lanes.length && lanes.at(-1) === null) {
      lanes.pop();
    }

    const width = Math.max(
      lane + 1,
      ...top.map((edge) => Math.max(edge.from, edge.to) + 1),
      ...bottom.map((edge) => Math.max(edge.from, edge.to) + 1)
    );
    laneCount = Math.max(laneCount, width);
    rows.push({ hash: commit.hash, lane, color, top, bottom, width });
  }
  return { rows, laneCount };
}
