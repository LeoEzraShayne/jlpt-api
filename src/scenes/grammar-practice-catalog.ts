// Practice tasks authored against data/N1-N5语法总结-有解释例句.txt.
// Match explicit grammar uses; unknown grammar gets no arbitrary scene or words.
export const PRACTICE_SELECTION_VERSION = 'grammar-context-v2';
export interface PracticeTask {
  objective: string;
  promptZh: string;
  words: string[];
}
export interface PracticeProfile {
  match: RegExp;
  domain: string;
  register: string;
  tasks: PracticeTask[];
}
const profile = (
  pattern: string,
  domain: string,
  register: string,
  tasks: [string, string, string][],
): PracticeProfile => ({
  match: new RegExp(pattern),
  domain,
  register,
  tasks: tasks.map(([objective, promptZh, words]) => ({
    objective,
    promptZh,
    words: words.split(' '),
  })),
});
export const practiceProfiles: PracticeProfile[] = [
  profile('かたがた', 'WORK', 'POLITE', [
    [
      'VISIT_REPORT',
      '你刚回国，登门拜访以前的老师。说明这次来访既是问候，也想报告回国后的近况。',
      '報告 挨拶',
    ],
    [
      'VISIT_THANKS',
      '一位前辈曾帮助过你。登门向对方致谢，同时问候对方近况，礼貌说明来意。',
      'お礼 挨拶',
    ],
  ]),
  profile('がてら', 'LIFE', 'CASUAL', [
    [
      'INVITE_WALK_ERRAND',
      '邀请朋友一起散步，说明途中还想顺便买些日用品。',
      '散歩 買い物',
    ],
    [
      'REPORT_OUTING_ERRAND',
      '告诉家人你外出买东西时，还顺便去看望了一位朋友。',
      '買い物 訪問',
    ],
  ]),
  profile('かたわら|^～?ながら$', 'LIFE', 'POLITE', [
    [
      'INTRODUCE_PARALLEL_ROUTINE',
      '介绍你平时工作或学习的同时，还坚持做的一项活动。',
      '仕事 勉強',
    ],
    [
      'EXPLAIN_PARALLEL_RESPONSIBILITIES',
      '向同事解释你目前同时承担的两项事情，以及你如何安排它们。',
      '仕事 計画',
    ],
  ]),
  profile('にかかわる', 'WORK', 'POLITE', [
    [
      'WARN_SERIOUS_RISK',
      '提醒同事认真对待一项可能危及安全的问题，并说明它的重要性。',
      '安全 重大',
    ],
    [
      'EXPLAIN_MAJOR_DECISION',
      '说明为什么公司需要慎重作出一项影响未来发展的决定。',
      '将来 判断',
    ],
  ]),
  profile('べく', 'WORK', 'FORMAL_WRITTEN', [
    [
      'REPORT_PURPOSE_ACTION',
      '在工作报告中说明：为了查清问题，你们已经展开调查。',
      '解決 調査',
    ],
    [
      'PROPOSE_PURPOSE_ACTION',
      '向团队提出一项具体行动，并说明它要实现的改进目标。',
      '改善 計画',
    ],
  ]),
  profile('をもって（手段）', 'WORK', 'FORMAL_WRITTEN', [
    [
      'NOTIFY_RESULT_METHOD',
      '代表机构通知申请人：审查结果将通过某种正式方式告知。',
      '審査 結果',
    ],
    [
      'THANK_BY_LETTER',
      '写一封正式的短信，说明你借这封信向协助者表达谢意。',
      '感謝 手紙',
    ],
  ]),
  profile('を限りに|限りで|をもって（期限、结束）', 'WORK', 'FORMAL_WRITTEN', [
    [
      'ANNOUNCE_SERVICE_END',
      '向用户正式通知某项服务将在指定日期结束。',
      '終了 サービス',
    ],
    [
      'ANNOUNCE_FINAL_PARTICIPATION',
      '告知相关人员你将以本次活动为最后一次，之后不再参加。',
      '参加 活動',
    ],
  ]),
  profile('を皮切り', 'WORK', 'POLITE', [
    [
      'ANNOUNCE_EVENT_SERIES',
      '向观众介绍巡回演出将从哪一站开始，以及后续的安排。',
      '公演 計画',
    ],
    [
      'REPORT_EXPANSION_SEQUENCE',
      '汇报一项活动从首次开展后，如何陆续扩展到其他地区。',
      '活動 地域',
    ],
  ]),
  profile('に至るまで|にとどまらず', 'LIFE', 'POLITE', [
    [
      'DESCRIBE_PARTICIPATION_RANGE',
      '介绍一项活动吸引了哪些不同年龄或背景的人参加，突出覆盖范围。',
      '参加 活動',
    ],
    [
      'DESCRIBE_PRODUCT_REACH',
      '介绍一件商品受到欢迎的范围，说明它的影响已经扩展到哪些地方。',
      '商品 海外',
    ],
  ]),
  profile('というところだ|といったところだ', 'WORK', 'POLITE', [
    [
      'ESTIMATE_COMPLETION_TIME',
      '同事询问进度，请大致估计距离完成还需要多少时间。',
      '完成 予定',
    ],
    [
      'ESTIMATE_BUDGET_LIMIT',
      '朋友询问活动预算，请说明你最多能承担的大致金额。',
      '予算 費用',
    ],
  ]),
  profile('にあって', 'WORK', 'FORMAL_WRITTEN', [
    [
      'REPORT_DIFFICULT_ENVIRONMENT',
      '在报告中说明企业在艰难的经营环境下仍取得的进展。',
      '成長 経済',
    ],
    [
      'ASSESS_CHANGING_ERA',
      '说明在技术快速变化的时代，学习者需要怎样适应。',
      '時代 変化',
    ],
  ]),
  profile('が早いか|や否や|^～?なり$', 'LIFE', 'POLITE', [
    [
      'DESCRIBE_IMMEDIATE_EVENT',
      '回忆一个动作刚发生，另一个动作便紧接着发生的情景。',
      '帰宅 行動',
    ],
    [
      'REPORT_SURPRISING_REACTION',
      '向朋友讲述某人听到消息后立即作出的意外反应。',
      '連絡 反応',
    ],
  ]),
  profile('そばから', 'LIFE', 'CASUAL', [
    [
      'COMPLAIN_REPEATED_FORGETTING',
      '告诉朋友你学习时刚记住内容就又忘记的烦恼，突出反复发生。',
      '単語 勉強',
    ],
    [
      'DESCRIBE_REPEATED_MESS',
      '向家人描述房间刚收拾好便又被弄乱的情形，表达无奈。',
      '掃除 部屋',
    ],
  ]),
  profile('てからというもの', 'LIFE', 'POLITE', [
    [
      'DESCRIBE_LIFE_TURNING_POINT',
      '介绍一件改变你生活的事情，以及此后一直保持的新习惯。',
      '生活 変化',
    ],
    [
      'REPORT_LASTING_IMPROVEMENT',
      '向同事汇报采用新方法之后，工作一直出现的积极变化。',
      '改善 仕事',
    ],
  ]),
  profile('ただ～のみ', 'WORK', 'FORMAL_WRITTEN', [
    [
      'STATE_ONLY_REMAINING_ACTION',
      '说明准备工作都已完成，现在唯一能做的事情是什么。',
      '結果 完成',
    ],
    [
      'STATE_SINGLE_COMMITMENT',
      '表达你在困难情况下仍然只有一个明确的目标或决心。',
      '努力 目標',
    ],
  ]),
  profile('ならでは', 'TRAVEL', 'POLITE', [
    [
      'RECOMMEND_LOCAL_FEATURE',
      '向游客推荐某地独有的一项体验，并说明其独特之处。',
      '地域 景色',
    ],
    [
      'APPRECIATE_PERSONAL_STRENGTH',
      '评价一位同事只有他才有的长处，以及这给团队带来的价值。',
      '経験 技術',
    ],
  ]),
  profile('をおいて', 'WORK', 'POLITE', [
    [
      'NOMINATE_BEST_PERSON',
      '向团队推荐最适合承担一项工作的人，表达非他莫属的判断。',
      '仕事 経験',
    ],
    [
      'CHOOSE_UNIQUE_PLACE',
      '说明为什么某个地方是你实现一个目标的唯一合适选择。',
      '場所 目標',
    ],
  ]),
  profile('はおろか', 'LIFE', 'POLITE', [
    [
      'DESCRIBE_BASIC_DIFFICULTY',
      '说明某人在学习中不仅做不了难的事情，连更基本的事情也做不到。',
      '漢字 勉強',
    ],
    [
      'EXPLAIN_SEVERE_SHORTAGE',
      '解释为何时间紧张到连最基本的安排都无法完成，更不用说较大的计划。',
      '時間 計画',
    ],
  ]),
  profile('もさることながら', 'LIFE', 'POLITE', [
    [
      'RECOMMEND_MULTIPLE_STRENGTHS',
      '评价一家店，承认一个优点之后，重点强调另一个更值得一提的优点。',
      '料理 接客',
    ],
    [
      'ASSESS_PERSONAL_QUALITIES',
      '评价一位同事，除了能力以外，再强调一项同样重要的品质。',
      '能力 努力',
    ],
  ]),
  profile('相まって', 'WORK', 'FORMAL_WRITTEN', [
    [
      'EXPLAIN_COMBINED_SUCCESS',
      '分析一项成功是如何由个人努力和另一个有利条件共同促成的。',
      '努力 成功',
    ],
    [
      'ANALYZE_COMBINED_APPEAL',
      '介绍某地的景色与文化如何共同形成吸引力。',
      '景色 文化',
    ],
  ]),
  profile('にもまして', 'LIFE', 'POLITE', [
    [
      'COMPARE_THIS_YEAR',
      '比较今年和去年某种现象的程度，突出今年更强烈。',
      '去年 今年',
    ],
    [
      'EMPHASIZE_GREATER_PRIORITY',
      '说明与某个重要条件相比，你更加重视的条件是什么。',
      '経験 努力',
    ],
  ]),
  profile('ないまでも', 'LIFE', 'POLITE', [
    [
      'SET_MINIMUM_HABIT',
      '谈谈你想培养的习惯：即使达不到理想频率，也希望至少做到什么程度。',
      '運動 目標',
    ],
    [
      'PROPOSE_MINIMUM_SUPPORT',
      '提出一个合理的帮助方案：即使无法完全解决问题，也至少能做些什么。',
      '解決 協力',
    ],
  ]),
  profile('にひきかえ', 'LIFE', 'POLITE', [
    ['COMPARE_PEOPLE', '描述两个人在性格或习惯上的明显反差。', '性格 行動'],
    [
      'COMPARE_OUTCOMES',
      '对比两个项目的结果，突出其中的明显差异。',
      '結果 成功',
    ],
  ]),
  profile('なりに|なりの', 'LIFE', 'POLITE', [
    [
      'EXPLAIN_PERSONAL_EFFORT',
      '向别人解释，虽然自己的能力有限，但已经按自己的方式努力过了。',
      '能力 努力',
    ],
    [
      'RESPECT_DIFFERENT_APPROACH',
      '解释为什么不同条件的人也有适合自己的想法或做法。',
      '経験 考え',
    ],
  ]),
  profile('ともなると|ともなれば', 'WORK', 'POLITE', [
    [
      'EXPLAIN_ROLE_RESPONSIBILITY',
      '说明一个人到了某个身份或职位，就需要承担怎样的责任。',
      '責任 行動',
    ],
    [
      'DESCRIBE_STAGE_CHANGE',
      '介绍一件事达到某种规模或阶段之后，会出现哪些变化。',
      '規模 変化',
    ],
  ]),
  profile('ともあろう', 'WORK', 'POLITE', [
    [
      'CRITICIZE_PROFESSIONAL_MISTAKE',
      '对一位专家竟然犯下基础错误表达惊讶和批评。',
      '専門家 失敗',
    ],
    [
      'QUESTION_LEADERS_BEHAVIOR',
      '对一位负责人做出不符合其身份的行为表达不满。',
      '責任 行動',
    ],
  ]),
  profile('に即し|を踏まえ', 'WORK', 'FORMAL_WRITTEN', [
    [
      'EXPLAIN_EVIDENCE_BASED_PLAN',
      '向同事说明如何依据调查结果或实际情况调整计划。',
      '調査 計画',
    ],
    [
      'PROPOSE_EXPERIENCE_BASED_POLICY',
      '在总结中提出后续方针，说明你考虑了哪些以往经验或结果。',
      '経験 方針',
    ],
  ]),
  profile('いかんによらず|いかんにかかわらず', 'WORK', 'FORMAL_WRITTEN', [
    [
      'STATE_UNCONDITIONAL_RULE',
      '正式说明一项规定无论理由如何都必须遵守。',
      '理由 規則',
    ],
    [
      'ANNOUNCE_EQUAL_ELIGIBILITY',
      '说明参与某项活动不受某个条件影响，对符合基本要求的人一视同仁。',
      '参加 条件',
    ],
  ]),
  profile('いかんでは|いかんによっては', 'WORK', 'FORMAL_WRITTEN', [
    [
      'WARN_CONDITIONAL_CONSEQUENCE',
      '告知合作方：根据今后的处理方式，你们可能采取进一步措施。',
      '対応 契約',
    ],
    [
      'DESCRIBE_CONTINGENCY',
      '说明根据调查结果，后续计划可能需要作出的调整。',
      '調査 計画',
    ],
  ]),
  profile(
    'いかんで(?!は)|いかんによって(?!は)|いかんだ',
    'WORK',
    'FORMAL_WRITTEN',
    [
      [
        'EXPLAIN_SELECTION_CRITERION',
        '说明一项录用或评选决定取决于哪方面的结果。',
        '結果 採用',
      ],
      [
        'EXPLAIN_PROJECT_DEPENDENCY',
        '向团队解释项目能否实施取决于什么条件。',
        '条件 計画',
      ],
    ],
  ),
  profile('をものともせず', 'WORK', 'POLITE', [
    [
      'PRAISE_OVERCOMING_OPPOSITION',
      '赞扬某人不顾周围反对，仍勇敢推进自己的计划。',
      '反対 計画',
    ],
    [
      'REPORT_OVERCOMING_DIFFICULTY',
      '介绍团队如何不畏困难而实现目标，表达赞赏。',
      '困難 成功',
    ],
  ]),
  profile('をよそに', 'LIFE', 'POLITE', [
    [
      'CRITICIZE_IGNORING_CONCERN',
      '讲述某人无视家人的担心，擅自采取行动，表达不满。',
      '心配 行動',
    ],
    [
      'CRITICIZE_IGNORING_CRITICISM',
      '描述某人不理会周围的批评，仍继续自己的做法。',
      '批判 態度',
    ],
  ]),
  profile('ならいざしらず', 'WORK', 'POLITE', [
    [
      'QUESTION_ADULT_BEHAVIOR',
      '说明某种行为如果是孩子尚可理解，但成年人不应如此。',
      '行動 責任',
    ],
    [
      'QUESTION_EXPERT_EXCUSE',
      '说明某种失误若是初学者可以理解，但有经验的人不应拿它作借口。',
      '経験 失敗',
    ],
  ]),
  profile('なり～なり', 'LIFE', 'POLITE', [
    [
      'OFFER_CONTACT_OPTIONS',
      '请对方从电话、邮件等方式中任选一种与你联系。',
      '電話 連絡',
    ],
    [
      'SUGGEST_HELP_OPTIONS',
      '建议遇到困难的朋友从几种求助方式中任选一种采取行动。',
      '相談 協力',
    ],
  ]),
  profile('といい～といい', 'LIFE', 'POLITE', [
    [
      'EVALUATE_PRODUCT_ASPECTS',
      '从设计和性能两个方面，对一件产品作出整体评价。',
      '性能 製品',
    ],
    [
      'EVALUATE_TRIP_ASPECTS',
      '从景色和料理两个方面，对一次旅行作出整体评价。',
      '景色 料理',
    ],
  ]),
];
export function practiceProfile(title: string) {
  return practiceProfiles.find((profile) => profile.match.test(title));
}
