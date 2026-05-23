import { BODY_TYPES } from "./types.js";
// Each array can contain plain RegExp (1 point) or a tuple [RegExp, weight] for custom weighting.
// The haystack per file is: relativePath + "\n" + basename + "\n" + first-4KB binary preview (latin1 lowercase).
// Physics config file names and BodySlide folder structures are strong signals.
const SIGNALS = {
    cbbe: [
        /\bcbbe\b/,
        /caliente/,
        /calientetools/,
        /cbbe curvy/,
        /cbbe slim/,
        /bodytalk/,
        // BodySlide folder structure
        /bodyslide[/\\]slidersets[/\\][^/\\]*cbbe/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*cbbe/,
        // Skeleton / NIF bone names embedded in binary NIF previews
        /npc l breast/,
        /npc r breast/,
        /npc l butt/,
        /npc r butt/,
        // CBPC config with CBBE-specific sections
        /cbpc.*cbbe/,
        /cbbe.*cbpc/,
    ],
    "3ba": [
        /\b3ba\b/,
        /\b3bbb\b/,
        /3bbb amazing/,
        /3ba body/,
        /acro748/,
        // Physics chain bones unique to 3BA (in NIF or CBPC configs)
        /npc lbreastroot/,
        /npc rbreastroot/,
        /npc l breast0[123]/,
        /npc r breast0[123]/,
        // HDT-SMP or CBPC config referencing 3BA
        /hdtphysicsextensions.*3b/,
        /3ba.*cbpc/,
        /cbpc.*3ba/,
        // BodySlide project files
        /bodyslide[/\\]slidersets[/\\][^/\\]*3b/,
    ],
    himbo: [
        /\bhimbo\b/,
        /highly improved male body/,
        /himbo body/,
        /tiktak/,
        // Male-only skeleton signals
        /malebody/,
        /male_body/,
        // HIMBO BodySlide project files
        /bodyslide[/\\]slidersets[/\\][^/\\]*himbo/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*himbo/,
    ],
    tbd: [
        /\btbd\b/,
        /thebiggestbody/,
        /touched by dibella/,
        /maars/,
        // TBD uses same breast-butt bones as CBBE but project files are named tbd
        /bodyslide[/\\]slidersets[/\\][^/\\]*tbd/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*tbd/,
    ],
    sos: [
        /\bsos\b/,
        /schlongs of skyrim/,
        /sos body/,
        /b3lisario/,
        // SOS genital bone names (in NIF binary previews)
        /npc genitalsbase/,
        /npc l genitalsscrotum/,
        /npc r genitalsscrotum/,
        // SOS partition reference
        /sbp_52/,
        /genitals/,
        // SOS BodySlide project files
        /bodyslide[/\\]slidersets[/\\][^/\\]*sos/,
    ],
    unp: [
        /\bunp\b/,
        /dimonized/,
        /dimon99/,
        /\bunpb\b/,
        // UNP BodySlide folder entries
        /bodyslide[/\\]slidersets[/\\][^/\\]*unp/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*unp/,
    ],
    bhunp: [
        /\bbhunp\b/,
        /bonehunger unp/,
        /unp 3bbb/,
        // Physics bones with BHUNP naming
        /bhunp breast/,
        /bhunp butt/,
        /bodyslide[/\\]slidersets[/\\][^/\\]*bhunp/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*bhunp/,
    ],
    uunp: [
        /\buunp\b/,
        /unified unp/,
        /ousnius.*unp/,
        /bodyslide[/\\]slidersets[/\\][^/\\]*uunp/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*uunp/,
    ],
    "7base": [
        /\b7base\b/,
        /sevenbase/,
        /seven base/,
        /crosscrusade/,
        /7b body/,
        /bodyslide[/\\]slidersets[/\\][^/\\]*7base/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*7base/,
    ],
    sam: [
        // Avoid broad /\bsam\b/ to prevent false positives on random filenames
        /shape atlas for men/,
        /sam light/,
        /vectorplexus/,
        /koulei.*sam/,
        /samlight/,
        // SAM BodySlide project files
        /bodyslide[/\\]slidersets[/\\][^/\\]*sam/,
        /bodyslide[/\\]shapedata[/\\][^/\\]*sam/,
    ],
    vanilla: [
        /\bvanilla\b/,
        /default body/,
        /base game body/,
        /bethesda.*body/,
        // Vanilla bodies are found directly in meshes/actors/character/
        /meshes[/\\]actors[/\\]character[/\\]character assets[/\\]femalebody/,
        /meshes[/\\]actors[/\\]character[/\\]character assets[/\\]malebody/,
    ],
};
function scoreFileForType(file, patterns) {
    const haystack = `${file.relativePath.toLowerCase()}\n${file.basename}\n${file.preview}`;
    let score = 0;
    for (const pattern of patterns) {
        if (pattern.test(haystack)) {
            score += 1;
        }
    }
    if ([".tri", ".osp", ".xml"].includes(file.extension)) {
        score += 0.2;
    }
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
            const score = scoreFileForType(file, SIGNALS[bodyType]);
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