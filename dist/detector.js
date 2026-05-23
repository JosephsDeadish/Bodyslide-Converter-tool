import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { BODY_TYPES } from "./types.js";
// Each array can contain plain RegExp (1 point) or a tuple [RegExp, weight] for custom weighting.
// The haystack per file is: relativePath + "\n" + basename + "\n" + first-4KB binary preview (latin1 lowercase).
// Physics config file names and BodySlide folder structures are strong signals.
const SIGNALS = {
    cbbe: [
        [/\bcbbe\b/, 2],
        [/caliente/, 2],
        [/calientetools/, 2],
        [/cbbe curvy/, 1.8],
        [/cbbe slim/, 1.8],
        [/cbbe[_ -]?body/, 1.5],
        // BodySlide folder structure
        [/bodyslide[/\\]slidersets[/\\][^/\\]*cbbe/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*cbbe/, 2.5],
        // Skeleton / NIF bone names embedded in binary NIF previews
        [/npc l breast/, 0.7],
        [/npc r breast/, 0.7],
        [/npc l butt/, 0.7],
        [/npc r butt/, 0.7],
        // CBPC config with CBBE-specific sections
        [/cbpc.*cbbe/, 1.5],
        [/cbbe.*cbpc/, 1.5],
    ],
    "3ba": [
        [/cbbe[_ -]?3ba/, 2.8],
        [/cbbe[_ -]?3bbb/, 2.8],
        [/\b3ba\b/, 2.2],
        [/\b3bbb\b/, 2.2],
        [/3bbb amazing/, 2.5],
        [/3ba body/, 2],
        [/acro748/, 1.5],
        // Physics chain bones unique to 3BA (in NIF or CBPC configs)
        [/npc lbreastroot/, 2.5],
        [/npc rbreastroot/, 2.5],
        [/npc l breast0[123]/, 2],
        [/npc r breast0[123]/, 2],
        [/npc belly/, 1],
        // HDT-SMP or CBPC config referencing 3BA
        [/hdtphysicsextensions.*3b/, 2],
        [/3ba.*cbpc/, 1.8],
        [/cbpc.*3ba/, 1.8],
        // BodySlide project files
        [/bodyslide[/\\]slidersets[/\\][^/\\]*3b/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*3b/, 2.5],
    ],
    himbo: [
        [/\bhimbo\b/, 2.5],
        [/highly improved male body/, 2.5],
        [/himbo body/, 2.2],
        [/high poly male body/, 1.8],
        [/highpolymalebody/, 1.8],
        [/tiktak/, 1.4],
        // Male-only skeleton signals
        [/malebody/, 0.6],
        [/male_body/, 0.6],
        // HIMBO BodySlide project files
        [/bodyslide[/\\]slidersets[/\\][^/\\]*himbo/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*himbo/, 2.5],
    ],
    bodytalk: [
        [/\bbodytalk\b/, 2.8],
        [/bodytalk[_ -]?v?[23]?/, 2.8],
        [/bt3\b/, 2.2],
        [/bodytalk body/, 2.2],
        [/bodytalk[_ -]?body/, 2.4],
        [/bad dog/, 1.4],
        [/haeun/, 1.4],
        [/malebody/, 0.7],
        [/male_body/, 0.7],
        [/bodyslide[/\\]slidersets[/\\][^/\\]*bodytalk/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*bodytalk/, 2.5],
    ],
    tbd: [
        [/\btbd\b/, 2.5],
        [/thebiggestbody/, 2],
        [/touched by dibella/, 2.5],
        [/touchedbydibella/, 2.5],
        [/tbd body/, 2],
        [/maars/, 1.5],
        // TBD uses same breast-butt bones as CBBE but project files are named tbd
        [/bodyslide[/\\]slidersets[/\\][^/\\]*tbd/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*tbd/, 2.5],
    ],
    sos: [
        [/\bsos\b/, 1.4],
        [/schlongs of skyrim/, 3],
        [/schlongsofskyrim/, 3],
        [/sos body/, 2.2],
        [/sos[-_ ]regular/, 2.4],
        [/sos[-_ ]light/, 2.4],
        [/b3lisario/, 1.4],
        // SOS genital bone names (in NIF binary previews)
        [/npc genitalsbase/, 3],
        [/npc l genitalsscrotum/, 2.5],
        [/npc r genitalsscrotum/, 2.5],
        // SOS partition reference
        [/sbp_52/, 2.5],
        [/genitals/, 1.5],
        // SOS BodySlide project files
        [/bodyslide[/\\]slidersets[/\\][^/\\]*sos/, 2.5],
    ],
    unp: [
        [/\bunp\b/, 2],
        [/dimonized/, 2],
        [/dimon99/, 2],
        [/\bunpb\b/, 1.5],
        // UNP BodySlide folder entries
        [/bodyslide[/\\]slidersets[/\\][^/\\]*unp/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*unp/, 2.5],
    ],
    bhunp: [
        [/\bbhunp\b/, 3],
        [/bonehunger unp/, 2.5],
        [/unp 3bbb/, 2.5],
        [/bhunp 3bbb/, 2.8],
        [/unp next generation/, 2.2],
        // Physics bones with BHUNP naming
        [/bhunp breast/, 2.2],
        [/bhunp butt/, 2.2],
        [/bodyslide[/\\]slidersets[/\\][^/\\]*bhunp/, 2.8],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*bhunp/, 2.8],
    ],
    uunp: [
        [/\buunp\b/, 2.6],
        [/unified unp/, 2.6],
        [/uunp special/, 2.8],
        [/ousnius.*unp/, 1.5],
        [/bodyslide[/\\]slidersets[/\\][^/\\]*uunp/, 2.8],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*uunp/, 2.8],
    ],
    "7base": [
        [/\b7base\b/, 2.6],
        [/sevenbase/, 2.6],
        [/seven base/, 2.6],
        [/crosscrusade/, 1.5],
        [/7b body/, 2],
        [/bodyslide[/\\]slidersets[/\\][^/\\]*7base/, 2.8],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*7base/, 2.8],
    ],
    sam: [
        // Avoid broad /\bsam\b/ to prevent false positives on random filenames
        [/shape atlas for men/, 3],
        [/sam light/, 2.8],
        [/vectorplexus/, 2],
        [/koulei.*sam/, 2],
        [/samlight/, 2.4],
        // SAM BodySlide project files
        [/bodyslide[/\\]slidersets[/\\][^/\\]*sam/, 2.5],
        [/bodyslide[/\\]shapedata[/\\][^/\\]*sam/, 2.5],
    ],
    vanilla: [
        [/\bvanilla\b/, 2.4],
        [/default body/, 2.2],
        [/base game body/, 2.2],
        [/bethesda.*body/, 2],
        // Vanilla bodies are found directly in meshes/actors/character/
        [
            /meshes[/\\]actors[/\\]character[/\\]character assets[/\\]femalebody/,
            2.2,
        ],
        [/meshes[/\\]actors[/\\]character[/\\]character assets[/\\]malebody/, 2.2],
    ],
};
function getSignalParts(signal) {
    if (signal instanceof RegExp) {
        return { pattern: signal, weight: 1 };
    }
    return { pattern: signal[0], weight: signal[1] };
}
function scoreGenderHint(file, bodyType) {
    const info = BODY_TYPE_INFO[bodyType];
    const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
    if (info.gender === "female") {
        return /(femalebody|femalehands|femalefeet|1stpersonfemale)/.test(haystack)
            ? 0.35
            : 0;
    }
    if (info.gender === "male") {
        return /(malebody|malehands|malefeet|1stpersonmale)/.test(haystack)
            ? 0.35
            : 0;
    }
    return 0;
}
function scoreFileForType(file, patterns, bodyType) {
    const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
    let score = 0;
    for (const signal of patterns) {
        const { pattern, weight } = getSignalParts(signal);
        if (pattern.test(haystack)) {
            score += weight;
        }
    }
    if ([".tri", ".osp", ".xml"].includes(file.extension)) {
        score += 0.2;
    }
    score += scoreGenderHint(file, bodyType);
    return score;
}
export function detectBodyType(files) {
    const scores = BODY_TYPES.reduce((acc, bodyType) => {
        acc[bodyType] = 0;
        return acc;
    }, {});
    const matchedSignals = new Set();
    for (const file of files) {
        for (const bodyType of BODY_TYPES) {
            const score = scoreFileForType(file, SIGNALS[bodyType], bodyType);
            scores[bodyType] += score;
            if (score > 0) {
                matchedSignals.add(`${bodyType}:${file.relativePath}`);
            }
        }
    }
    const sorted = [...BODY_TYPES].sort((a, b) => scores[b] - scores[a]);
    const bestType = sorted.at(0);
    const total = sorted.reduce((sum, bodyType) => sum + scores[bodyType], 0);
    const rankedCandidates = sorted
        .map((bodyType) => ({
        bodyType,
        score: Number(scores[bodyType].toFixed(2)),
        share: Number((scores[bodyType] / Math.max(total, 1)).toFixed(2)),
    }))
        .filter((candidate) => candidate.score > 0)
        .slice(0, 5);
    if (!bestType) {
        return {
            bodyType: "unknown",
            confidence: 0,
            scores,
            rankedCandidates: [],
            matchedSignals: [],
        };
    }
    const bestScore = scores[bestType];
    if (bestScore <= 0) {
        return {
            bodyType: "unknown",
            confidence: 0,
            scores,
            rankedCandidates: [],
            matchedSignals: [],
        };
    }
    return {
        bodyType: bestType,
        confidence: Number((bestScore / Math.max(total, 1)).toFixed(2)),
        scores,
        rankedCandidates,
        matchedSignals: [...matchedSignals].slice(0, 30),
    };
}
//# sourceMappingURL=detector.js.map