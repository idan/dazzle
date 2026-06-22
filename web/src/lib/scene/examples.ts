// Starter scenes for the editor. Each exercises a different slice of the
// language so the spike doubles as a smoke test for the interpreter.

export interface Example {
	id: string;
	name: string;
	source: string;
}

export const EXAMPLES: Example[] = [
	{
		id: 'palette-vignette',
		name: 'Palette vignette',
		source: `// The reference scene from docs/scenes/shader-language.md.
uniform float speed = 0.4;
uniform vec3  tint  = vec3(1.0, 0.9, 0.8);

frame {
    float phase = t * speed;
}

pixel {
    float d = length(st);                  // st: centered, -1..1
    vec3  c = palette(phase + d) * tint;   // IQ cosine palette
    float a = smoothstep(1.0, 0.0, d);     // vignette to transparent edge
    color = vec4(c * a, a);                // premultiplied
}
`
	},
	{
		id: 'plasma',
		name: 'Plasma',
		source: `// Classic sine plasma. Everything cheap goes in frame{}.
uniform float speed = 1.0;

frame {
    float ph = t * speed;
}

pixel {
    float v = sin(st.x * 4.0 + ph)
            + sin(st.y * 4.0 - ph)
            + sin((st.x + st.y) * 3.0 + ph * 0.7);
    vec3 c = palette(v * 0.25 + ph * 0.1);
    color = vec4(c, 1.0);
}
`
	},
	{
		id: 'fbm-clouds',
		name: 'fbm clouds',
		source: `// Animated value noise via fbm; the 3rd noise axis is time.
uniform float scale = 3.0;
uniform vec3  tint  = vec3(0.6, 0.8, 1.0);

pixel {
    vec3 p = vec3(uv * scale, t * 0.2);
    float n = fbm(p, 5);
    vec3 c = tint * n;
    color = vec4(c, 1.0);
}
`
	},
	{
		id: 'rings',
		name: 'Pulsing rings',
		source: `// if/else and a moving radial wave.
uniform float speed = 1.5;

pixel {
    float d = length(st);
    float w = fract(d * 4.0 - t * speed);
    vec3 c = palette(d + t * 0.1);
    if (w < 0.5) {
        color = vec4(c, 1.0);
    } else {
        color = vec4(c * 0.15, 1.0);
    }
}
`
	}
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
