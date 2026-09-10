-- Stable communication objectives, not noun-substitution labels.
INSERT INTO "TrainingScenario" (id,domain,objective,register,"promptZh",levels,version) VALUES
('life-propose-plan','LIFE','PROPOSE_PLAN','CASUAL','向朋友提出一个周末安排，并说明为什么适合你们。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('life-decline-invitation','LIFE','DECLINE_INVITATION','POLITE','礼貌拒绝朋友的邀请，解释原因并提出另一个时间。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('life-share-change','LIFE','DESCRIBE_CHANGE','CASUAL','向朋友描述最近生活中的一个变化及你的感受。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('work-explain-delay','WORK','EXPLAIN_CAUSE','POLITE','向同事说明工作延误的原因及你准备采取的措施。',ARRAY['N1','N2','N3']::"JlptLevel"[],'scenario-v1'),
('work-request-help','WORK','REQUEST_HELP','POLITE','向同事请求一项具体帮助，并说明需要完成的事情。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('work-compare-options','WORK','COMPARE_OPTIONS','POLITE','比较两种工作方案，并给出你的选择与理由。',ARRAY['N1','N2','N3']::"JlptLevel"[],'scenario-v1'),
('travel-change-booking','TRAVEL','NEGOTIATE_CHANGE','POLITE','向旅馆说明需要更改预约，提出具体要求。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('travel-ask-route','TRAVEL','CLARIFY_INFORMATION','POLITE','向车站工作人员确认路线或换乘信息，说明你担心的问题。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('travel-recommend-place','TRAVEL','MAKE_RECOMMENDATION','CASUAL','向朋友推荐一个旅行目的地，说明它适合什么样的人。',ARRAY['N1','N2','N3','N4']::"JlptLevel"[],'scenario-v1'),
('formal-assess-impact','FORMAL','ASSESS_IMPACT','FORMAL_WRITTEN','用正式书面表达评价一项政策或技术带来的影响，说明判断依据。',ARRAY['N1']::"JlptLevel"[],'scenario-v1'),
('formal-address-objection','FORMAL','ADDRESS_OBJECTION','FORMAL_WRITTEN','用正式书面表达回应一种反对意见，承认其合理之处并提出你的判断。',ARRAY['N1']::"JlptLevel"[],'scenario-v1'),
('formal-propose-remedy','FORMAL','PROPOSE_REMEDY','FORMAL_WRITTEN','用正式书面表达指出一个社会问题，并提出解决建议及其理由。',ARRAY['N1']::"JlptLevel"[],'scenario-v1');
