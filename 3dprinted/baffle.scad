// baffle.scad — grid baffle for the pixel64 64x64 HUB75 LED panel
//
// A grid of thin walls that sits between the LED panel and a diffuser sheet,
// giving each of the 4096 pixels its own optical cell so light can't bleed
// sideways into its neighbours.
//
// Every cell is identical (pitch - wall). The outer wall extends OUTWARD past
// the panel edge rather than inward, so the border pixels stay full size; the
// footprint is therefore slightly larger than the 192mm panel (a future frame
// enclosure can capture this lip).
//
// Print FLAT (this footprint flat on the bed, walls growing up in +Z).
// No supports needed — it's an open grid, nothing overhangs.
// Intended material: black matte PLA.

/* ---------------- parameters ---------------- */
pitch  = 3;     // LED pixel pitch (mm)  -> cell size
n      = 64;    // pixels per side
wall   = 0.45;  // internal wall thickness (mm). A hair over the 0.4mm nozzle so
                // the slicer reliably lays one solid perimeter (a true 0.4 == the
                // line width gets dropped unless "Detect thin wall" is on).
height = 5;     // wall / baffle height in Z (mm)
border = 0.8;   // outer wall thickness (mm). Extends OUTWARD past the panel so
                // it never eats into the edge pixels. Set == wall for a fully
                // uniform-thickness grid.

span = n * pitch;            // 192 mm — the actual panel/pixel area
ext  = border - wall / 2;    // how far the outer wall sticks out past the panel
echo(span = span, footprint = span + 2 * ext, cells = n * n);

/* ---------------- geometry ------------------ */

// interior walls, centered on the inter-pixel boundaries (x,y = 3, 6, ... 189)
module internal_walls() {
    for (k = [1 : n - 1]) {
        // walls running along Y (constant x)
        translate([k * pitch - wall / 2, 0, 0])
            cube([wall, span, height]);
        // walls running along X (constant y)
        translate([0, k * pitch - wall / 2, 0])
            cube([span, wall, height]);
    }
}

// outer frame: inner faces sit flush with the edge pixels' openings, body
// extends outward past the panel edge so border pixels are full size.
module frame() {
    difference() {
        translate([-ext, -ext, 0])
            cube([span + 2 * ext, span + 2 * ext, height]);
        translate([wall / 2, wall / 2, -1])
            cube([span - wall, span - wall, height + 2]);
    }
}

union() {
    frame();
    internal_walls();
}
