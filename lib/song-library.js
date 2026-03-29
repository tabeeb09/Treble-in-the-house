const fs = require("fs");
const path = require("path");

function createStep(step) {
  return {
    responseType: "short_text",
    revealInFinalSong: true,
    constraints: {
      maxWords: 8,
      maxChars: 80
    },
    bindings: [],
    sharedTextTemplate: null,
    ...step
  };
}

function normalizeSong(song) {
  return {
    ...song,
    promptUnits: (Array.isArray(song?.promptUnits) ? song.promptUnits : []).map((unit) => ({
      ...unit,
      steps: (Array.isArray(unit?.steps) ? unit.steps : []).map((step) => createStep(step))
    }))
  };
}

function loadSongsFromDirectory() {
  const songsDirectory = path.join(__dirname, "songs");

  if (!fs.existsSync(songsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(songsDirectory)
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .sort()
    .map((fileName) => {
      const rawContent = fs.readFileSync(path.join(songsDirectory, fileName), "utf8");
      return normalizeSong(JSON.parse(rawContent));
    });
}

const embeddedSongs = [
    {
      id: "budget_eurovision_union_bar",
      title: "Budget Eurovision at the Union Bar",
      publicTheme: "Cheap student pop stardom with dangerous confidence",
      roleThemes: {
        lyricist:
          "A chaotic student pop anthem. Everyone thinks they are iconic, the lighting is tragic, and the confidence is irrationally high.",
        imposter:
          "A suspicious wellness retreat anthem. Everyone is being slowly recruited by an over-smiling guru into a very uncool inner-peace pyramid scheme."
      },
      promptUnits: [
        {
          id: "euro_intro_1",
          order: 1,
          section: "intro",
          outputTemplate: "{hype_adlib} | {lyric_fill}",
          steps: [
            createStep({
              id: "hype_adlib",
              order: 1,
              kind: "vague_social_prompt",
              bindings: [
                {
                  key: "targetPlayerName",
                  type: "string",
                  source: {
                    kind: "random_other_alive_player_name"
                  }
                }
              ],
              lyricist: {
                promptTemplate:
                  "In 3 to 8 words, lightly roast {{targetPlayerName}} like they are a doomed but beloved pop star.",
                defaultBotInstructionTemplate:
                  "Write a short affectionate roast with cheap-pop energy about {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} serves panic with glitter",
                defaultTag: "affectionate_pop_roast"
              },
              imposter: {
                promptTemplate:
                  "In 3 to 8 words, lightly praise {{targetPlayerName}} like they are spiritually ready to ascend at a wellness retreat.",
                defaultBotInstructionTemplate:
                  "Write a short pseudo-enlightened compliment about {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} vibrates at premium frequency",
                defaultTag: "wellness_guru_praise"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "Tonight we roll in like ____ in sequins",
              lyricist: {
                promptTemplate:
                  "Fill the blank so it sounds like low-budget but unstoppable student pop glory.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with scrappy glamorous student-pop imagery.",
                defaultResponseTemplate: "discount royalty",
                defaultTag: "cheap_glamour"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank so it sounds like calm, suspicious, luxury-spiritual awakening energy.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with fake-serene retreat imagery.",
                defaultResponseTemplate: "enlightened swans",
                defaultTag: "fake_serenity"
              }
            })
          ]
        },
        {
          id: "euro_chorus_1",
          order: 2,
          section: "chorus",
          outputTemplate: "{brainrot_caption} | {lyric_fill}",
          steps: [
            createStep({
              id: "brainrot_caption",
              order: 1,
              kind: "brainrot_caption",
              lyricist: {
                promptTemplate:
                  "Give this performance a chaotic brainrot caption, like a fan cam from a night that should not exist.",
                defaultBotInstructionTemplate:
                  "Write a short brainrot caption for student pop chaos.",
                defaultResponseTemplate: "unioncore diva meltdown era",
                defaultTag: "brainrot_pop"
              },
              imposter: {
                promptTemplate:
                  "Give this performance a brainrot caption, but make it sound like a manipulative mindfulness seminar clip.",
                defaultBotInstructionTemplate:
                  "Write a short brainrot caption for fake healing cult energy.",
                defaultResponseTemplate: "chakramaxxing moonwater drop",
                defaultTag: "brainrot_wellness"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "We clap off beat but the room says ____",
              lyricist: {
                promptTemplate:
                  "Fill the blank with something that sounds like the crowd is delusionally supportive.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with affectionate delusional crowd approval.",
                defaultResponseTemplate: "icons anyway",
                defaultTag: "delusional_support"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank with something that sounds like the room is surrendering to a suspiciously calm group mindset.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with cultish collective approval.",
                defaultResponseTemplate: "breathe and comply",
                defaultTag: "cultish_agreement"
              }
            })
          ]
        },
        {
          id: "euro_chorus_2",
          order: 3,
          section: "chorus",
          outputTemplate: "{player_comment} | {lyric_fill}",
          steps: [
            createStep({
              id: "player_comment",
              order: 1,
              kind: "comment_on_player",
              bindings: [
                {
                  key: "targetPlayerName",
                  type: "string",
                  source: {
                    kind: "random_other_alive_player_name"
                  }
                }
              ],
              lyricist: {
                promptTemplate:
                  "Describe {{targetPlayerName}} like they are doing backup choreography with too much commitment and not enough rhythm.",
                defaultBotInstructionTemplate:
                  "Write a short playful insult about {{targetPlayerName}} and chaotic dancing.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} pirouettes like unpaid WiFi",
                defaultTag: "chaotic_dance_roast"
              },
              imposter: {
                promptTemplate:
                  "Describe {{targetPlayerName}} like they are a promising new disciple with unusual but marketable aura.",
                defaultBotInstructionTemplate:
                  "Write a short weirdly approving guru-style line about {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} glows with sponsor-ready peace",
                defaultTag: "guru_recruitment"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "Even the smoke machine fears ____",
              lyricist: {
                promptTemplate:
                  "Fill the blank with something silly that suggests the performance is too powerful for the venue.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with comic overconfidence.",
                defaultResponseTemplate: "our budget charisma",
                defaultTag: "overconfident_venue_chaos"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank with something calm but ominously spiritually powerful.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with fake mystical authority.",
                defaultResponseTemplate: "the cleansing mist",
                defaultTag: "mystic_authority"
              }
            })
          ]
        },
        {
          id: "euro_outro",
          order: 4,
          section: "outro",
          outputTemplate: "{exit_tag} | {lyric_fill}",
          steps: [
            createStep({
              id: "exit_tag",
              order: 1,
              kind: "vague_social_prompt",
              lyricist: {
                promptTemplate:
                  "Give the final vibe tag for this performance, like the audience is weirdly changed by it.",
                defaultBotInstructionTemplate:
                  "Write a short absurd closing tag for student pop chaos.",
                defaultResponseTemplate: "bar floor canonized forever",
                defaultTag: "absurd_pop_closure"
              },
              imposter: {
                promptTemplate:
                  "Give the final vibe tag for this ceremony, like everyone is quietly signing up for tiered enlightenment packages.",
                defaultBotInstructionTemplate:
                  "Write a short absurd closing tag for fake spiritual conversion.",
                defaultResponseTemplate: "bronze chakra package unlocked",
                defaultTag: "tiered_enlightenment"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "This tiny stage becomes ____ by midnight",
              lyricist: {
                promptTemplate:
                  "Fill the blank so it sounds like this small grubby venue has become legendary.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with mythic student-night-out energy.",
                defaultResponseTemplate: "our little empire",
                defaultTag: "mythic_venue"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank so it sounds like the space has transformed into a suspicious temple of guided self-improvement.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with soft cult transformation energy.",
                defaultResponseTemplate: "a moonlit sanctum",
                defaultTag: "soft_cult_temple"
              }
            })
          ]
        }
      ]
    },
    {
      id: "all_inclusive_emotionally_not",
      title: "All Inclusive But Emotionally Not",
      publicTheme: "Chaotic package holiday nonsense",
      roleThemes: {
        lyricist:
          "A stupidly cheerful all-inclusive holiday anthem. Cheap buffet, sunburn, plastic cups, karaoke, poolside delusion.",
        imposter:
          "A quarterly sales summit anthem. Lanyards, networking smiles, synergy, keynote slides, deeply cursed corporate optimism."
      },
      promptUnits: [
        {
          id: "resort_intro_1",
          order: 1,
          section: "intro",
          outputTemplate: "{player_comment} | {lyric_fill}",
          steps: [
            createStep({
              id: "player_comment",
              order: 1,
              kind: "comment_on_player",
              bindings: [
                {
                  key: "targetPlayerName",
                  type: "string",
                  source: {
                    kind: "random_other_alive_player_name"
                  }
                }
              ],
              lyricist: {
                promptTemplate:
                  "Describe {{targetPlayerName}} like they have been at the pool bar since breakfast and are thriving somehow.",
                defaultBotInstructionTemplate:
                  "Write a short playful resort-party description about {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} marinates in poolside delusion",
                defaultTag: "poolside_goblin"
              },
              imposter: {
                promptTemplate:
                  "Describe {{targetPlayerName}} like they have already introduced themselves to forty strangers and love a keynote.",
                defaultBotInstructionTemplate:
                  "Write a short cursed networking compliment about {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} radiates premium networking hunger",
                defaultTag: "conference_climber"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "By noon the buffet looked like ____",
              lyricist: {
                promptTemplate:
                  "Fill the blank so it sounds like the holiday buffet has descended into cheerful chaos.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with messy holiday buffet imagery.",
                defaultResponseTemplate: "a beige battlefield",
                defaultTag: "buffet_chaos"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank so it sounds like a conference catering table after aggressive corporate mingling.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with stale business-event catering imagery.",
                defaultResponseTemplate: "post-panel fallout",
                defaultTag: "corporate_catering"
              }
            })
          ]
        },
        {
          id: "resort_chorus_1",
          order: 2,
          section: "chorus",
          outputTemplate: "{brainrot_caption} | {lyric_fill}",
          steps: [
            createStep({
              id: "brainrot_caption",
              order: 1,
              kind: "brainrot_caption",
              lyricist: {
                promptTemplate:
                  "Give this holiday a brainrot caption like a cursed travel reel that somebody's aunt reposted.",
                defaultBotInstructionTemplate:
                  "Write a short brainrot caption for cheap holiday chaos.",
                defaultResponseTemplate: "sunmaxxing on frazzle mode",
                defaultTag: "brainrot_holiday"
              },
              imposter: {
                promptTemplate:
                  "Give this summit a brainrot caption like a cursed leadership clip on professional social media.",
                defaultBotInstructionTemplate:
                  "Write a short brainrot caption for grindset conference energy.",
                defaultResponseTemplate: "synergycore thought-leader arc",
                defaultTag: "brainrot_corporate"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "We chase the sun like ____ on hotel WiFi",
              lyricist: {
                promptTemplate:
                  "Fill the blank with something stupid and lively that suits chaotic holiday desperation.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with silly frantic holiday imagery.",
                defaultResponseTemplate: "confused seagulls",
                defaultTag: "frantic_holiday"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank with something that suits over-motivated networking ambition on weak convention-centre internet.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with thirsty careerist imagery.",
                defaultResponseTemplate: "interns after metrics",
                defaultTag: "thirsty_careerism"
              }
            })
          ]
        },
        {
          id: "resort_chorus_2",
          order: 3,
          section: "chorus",
          outputTemplate: "{social_observation} | {lyric_fill}",
          steps: [
            createStep({
              id: "social_observation",
              order: 1,
              kind: "vague_social_prompt",
              bindings: [
                {
                  key: "targetPlayerName",
                  type: "string",
                  source: {
                    kind: "random_other_alive_player_name"
                  }
                }
              ],
              lyricist: {
                promptTemplate:
                  "Say what energy {{targetPlayerName}} brings to the karaoke queue at 1 AM.",
                defaultBotInstructionTemplate:
                  "Write a short funny observation about late-night resort karaoke energy for {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} queues with sunburnt conviction",
                defaultTag: "karaoke_chaos"
              },
              imposter: {
                promptTemplate:
                  "Say what energy {{targetPlayerName}} brings to the networking mixer after the keynote.",
                defaultBotInstructionTemplate:
                  "Write a short funny observation about post-keynote networking energy for {{targetPlayerName}}.",
                defaultResponseTemplate:
                  "{{targetPlayerName}} cold-opens with terrifying confidence",
                defaultTag: "mixer_hustle"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "The karaoke moon says ____",
              lyricist: {
                promptTemplate:
                  "Fill the blank like the night sky is encouraging one more terrible holiday anthem.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with indulgent holiday-night encouragement.",
                defaultResponseTemplate: "one more disaster",
                defaultTag: "nighttime_indulgence"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank like the corporate event itself is demanding one more ambitious push.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with pushy productivity energy.",
                defaultResponseTemplate: "circle back harder",
                defaultTag: "pushy_corporate"
              }
            })
          ]
        },
        {
          id: "resort_outro",
          order: 4,
          section: "outro",
          outputTemplate: "{final_tag} | {lyric_fill}",
          steps: [
            createStep({
              id: "final_tag",
              order: 1,
              kind: "vague_social_prompt",
              lyricist: {
                promptTemplate:
                  "Give the final emotional summary of this holiday, like nobody learned anything useful but everybody has opinions.",
                defaultBotInstructionTemplate:
                  "Write a short comic holiday epilogue.",
                defaultResponseTemplate: "nobody healed but vibes survived",
                defaultTag: "holiday_epilogue"
              },
              imposter: {
                promptTemplate:
                  "Give the final emotional summary of this summit, like everyone left with lanyards, jargon, and a damaged soul.",
                defaultBotInstructionTemplate:
                  "Write a short comic corporate epilogue.",
                defaultResponseTemplate: "souls down metrics up",
                defaultTag: "corporate_epilogue"
              }
            }),
            createStep({
              id: "lyric_fill",
              order: 2,
              kind: "complete_the_lyric",
              sharedTextTemplate: "This resort is basically ____ with sangria",
              lyricist: {
                promptTemplate:
                  "Fill the blank with a funny image that makes the resort sound gloriously trashy but lovable.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with trashy affectionate holiday imagery.",
                defaultResponseTemplate: "daycare for adults",
                defaultTag: "trashy_but_lovable"
              },
              imposter: {
                promptTemplate:
                  "Fill the blank with a funny image that makes the event sound like corporate suffering in disguise.",
                defaultBotInstructionTemplate:
                  "Complete the lyric with comic conference misery imagery.",
                defaultResponseTemplate: "LinkedIn on laminate",
                defaultTag: "conference_misery"
              }
            })
          ]
        }
      ]
    }
];

module.exports = {
  schemaVersion: "1.1",
  botPolicy: {
    onTimeout: "use_role_default_response",
    onSkip: "use_role_default_response",
    onMissingAssignedPlayer: "fill_entire_unit_with_role_defaults"
  },
  assignmentPolicy: {
    unitAssignment: "one_prompt_unit_per_player_in_song_order",
    unusedUnits: "fill_with_bot_defaults",
    extraPlayers: "leave_unassigned_or_move_to_audience"
  },
  songs: [...embeddedSongs.map((song) => normalizeSong(song)), ...loadSongsFromDirectory()]
};
