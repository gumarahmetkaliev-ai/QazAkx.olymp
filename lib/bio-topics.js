/**
 * Тема вопроса по биологии по ключевым словам (рус/каз/англ) — для «что повторить» и книг.
 * Темы — data/topics.json → biology.
 */

const RULES = [
  ["bio-photosynthesis", /автотроф|фотосинт|хлорофил|хлоропласт|тилакоид|кальвин|фотосистем|c4|сам-растен|photosynth|chloroplast|calvin|фотосинтез/i],
  ["bio-metabolism", /гетеротроф|клеточн\w* дыхани|энергетик|гликолиз|кребс|дыхательн\w* цеп|окислительн\w* фосфорил|атф|atp|митохондри|брожен|ферментац|glycoly|krebs|citric acid|respiration|fermentation|метаболизм|катаболизм|анаболизм/i],
  ["bio-molecular", /днк|рнк|dna|rna|репликац|транскрипц|трансляц|кодон|рибосом|ген\w* код|полимераз|сплайс|интрон|экзон|replicat|transcript|translat|codon|ribosom|нуклеотид|теломер/i],
  ["bio-gene-regulation", /оперон|экспресси|регуляц\w* ген|промотор|энхансер|crispr|пцр|pcr|клонир|плазмид|рестрикт|биотехнолог|трансген|operon|plasmid|restriction|electrophor|электрофорез|blot|блот/i],
  ["bio-popgen", /evolution of populations|популяц\w* генетик|харди|вайнберг|hardy|weinberg|частот\w* аллел|генофонд|дрейф ген|allele frequenc|популяционн\w* генет/i],
  ["bio-genetics", /изменчивост|генетик|наследствен|mendel|inherit|скрещив|генотип|фенотип|доминант|рецессив|аллел|гомозигот|гетерозигот|сцеплен|кроссинговер|мендел|наследова|родословн|хромосомн\w* аномал|cross(ing)?|genotype|phenotype|dominant|recessive|linkage|pedigree|epista|эпистаз/i],
  ["bio-cell-cycle", /митоз|мейоз|клеточн\w* цикл|интерфаз|профаз|метафаз|анафаз|телофаз|цитокинез|mitosis|meiosis|cell cycle|хроматид/i],
  ["bio-biochem", /белок|белк|аминокислот|фермент|энзим|углевод|липид|жир|сахар|глюкоз|пептид|протеин|кофермент|витамин|protein|amino acid|enzyme|carbohydrate|lipid|polysacchar|моносахар|стероид|холестерин|\bpka\b|(?<![A-Za-z])pH(?![A-Za-z])/i],
  ["bio-cell", /мембран|органелл|цитоплазм|ядро клетк|эндоплазмат|аппарат гольджи|гольджи|лизосом|вакуол|цитоскелет|клеточн\w* стенк|осмос|диффуз|эндоцитоз|экзоцитоз|membrane|organelle|golgi|lysosome|osmosis|cytoskeleton|прокариот|эукариот/i],
  ["bio-microbio", /микробиолог|бактери|вирус|бактериофаг|прокариот|археи|грибы|дрожж|плесен|антибиот|bacteri|virus|phage|archae|fung/i],
  ["bio-immunology", /иммун|антител|антиген|лимфоцит|т-клетк|в-клетк|вакцин|комплемент|воспален|immun|antibod|antigen|lymphocyt|vaccin|цитокин|интерферон/i],
  ["bio-neuro", /координац|nervous|sensory|endocrine|нейрон|нервн|синапс|потенциал действ|медиатор|рефлекс|гормон|эндокрин|гипофиз|щитовидн|инсулин|адреналин|кортизол|глюкокортик|орган\w* чувств|сетчатк|neuron|synap|action potential|hormone|endocrin|insulin/i],
  ["bio-human-physiology", /экскрец|осморегуляц|транспорт у животн|питание у животн|газообмен|circulat|respirat\w* system|excret|osmoreg|кров|сердц|сосуд|давлени|эритроцит|гемоглобин|дыхани|лёгк|легк|пищеварен|желуд|кишечник|печен|почк|нефрон|мочев|выделен|ренин|ангиотензин|альдостерон|сфинктер|blood|heart|kidney|nephron|digest|lung|liver/i],
  ["bio-plants", /транспорт у растени|покрытосемен|растени|корн|стебел|стебл|лист|цветок|цветк|плод|семен|опылен|ксилем|флоэм|устьиц|ауксин|гиббереллин|фитогормон|транспирац|мхи|папоротник|голосемен|покрытосемен|plant|root|stem|xylem|phloem|stomat|auxin|angiosperm|gymnosperm/i],
  ["bio-animal-anatomy", /членистоног|насеком|моллюск|кольчат|черв|рыб|земноводн|амфиби|рептили|пресмыкающ|птиц|млекопитающ|хордов|позвоночн|беспозвоночн|кишечнополост|губк|скелет|arthropod|insect|mollus|vertebrat|chordat|mammal|bird|reptil|amphibi/i],
  ["bio-development", /рост и развит|размножени|development|reproduc|оплодотвор|гамет|сперм|яйцеклетк|зигот|эмбрион|гаструл|бластул|онтогенез|размножен|менструац|беременн|плацент|fertiliz|gamete|embryo|gastrul|reproduct/i],
  ["bio-evolution", /эволюц|естественн\w* отбор|видообраз|филоген|кладограм|гомолог|аналог|ископаем|дарвин|адаптац|evolution|natural selection|speciation|phylogen|clad|homolog|fossil/i],
  ["bio-systematics", /систематик|таксон|царств|бинарн\w* номенклатур|классификаци\w* (организм|живого|растений|животных)|подцарств|надотряд|надкласс|подтип|taxonom|kingdom|phylum|systematics|five kingdoms/i],
  ["bio-ecology", /организмы и окружающ|окружающ\w* сред|эколог|популяци|сообществ|экосистем|биоценоз|пищев\w* цеп|трофическ|продуцент|консумент|редуцент|биом|сукцесс|хищник|паразит|симбиоз|конкуренц|biom|ecosystem|food chain|trophic|predator|parasit|symbio|competition|carrying capacity/i],
  ["bio-ethology", /поведен|инстинкт|импринтинг|научени|территориальн|ухаживан|behavio|instinct|imprint/i],
  ["bio-methods", /график|эксперимент|контрольн\w* групп|гипотез|микроскоп|статистик|хи-квадрат|chi-square|experiment|hypothesis|microscop/i],
];

/** id темы или "bio-methods" по умолчанию, если ничего не подошло */
function classifyBio(text) {
  const t = String(text || "");
  for (const [id, re] of RULES) if (re.test(t)) return id;
  return null;
}

module.exports = { classifyBio, RULES };
