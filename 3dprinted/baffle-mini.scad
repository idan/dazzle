// baffle-mini.scad — 10x10 test swatch of baffle.scad
//
// Same geometry as baffle.scad (identical pitch / wall / height / border), just
// clipped to a 10x10 corner so you can verify pitch + fit with a short print and
// almost no filament before committing to the full 64x64.
//
// Outer reference walls only on the LEFT (x=0) and BOTTOM (y=0) edges; the top
// and right are left open. Like the full part, the outer walls extend OUTWARD
// past the edge, so every pixel cell — including the edge ones — is the same
// size. Print FLAT, no supports. Black matte PLA.

/* ---------------- parameters ---------------- */
pitch  = 3;     // LED pixel pitch (mm)  -> cell size
n      = 10;    // cells per side in this test swatch
wall   = 0.45;  // internal wall thickness (mm). A hair over the 0.4mm nozzle so
                // the slicer reliably lays one solid perimeter (a true 0.4 == the
                // line width gets dropped unless "Detect thin wall" is on).
height = 5;     // wall height in Z (mm)
border = 0.8;   // thickness of the bottom/left reference walls (mm)

span = n * pitch;            // 30 mm
ext  = border - wall / 2;    // outer-wall overhang past the edge
echo(span = span, cells = n * n);

/* ---------------- geometry ------------------ */

// interior walls at x,y = 3, 6, ... (n-1)*pitch
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

// outer reference walls on the LEFT (x=0) and BOTTOM (y=0) edges only.
// Their inner faces sit flush with the edge pixels' openings; the body extends
// outward (past x=0 / y=0) so the edge pixels stay full size.
module corner_walls() {
    translate([-ext, -ext, 0]) cube([border, span + ext, height]); // left
    translate([-ext, -ext, 0]) cube([span + ext, border, height]); // bottom
}

union() {
    corner_walls();
    internal_walls();
}
