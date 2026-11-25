const { test } = require("node:test");
const assert = require("node:assert/strict");
const N = require("../js/nucleo.js");
const lib = require("../vendor/libphonenumber-min.js");

const REGRAS = { minima: 18, maxima: 120 };

test("idade: vazio, espaços, não inteiro, mínimo, máximo explícito e 100 anos", () => {
  assert.equal(N.validarIdade("", REGRAS).erro, "Informe sua idade para continuar.");
  assert.equal(N.validarIdade("   ", REGRAS).erro, "Informe sua idade para continuar.");
  for (const v of ["30,5", "30.5"]) assert.match(N.validarIdade(v, REGRAS).erro, /anos completos, sem vírgula ou ponto\. Ex\.: 30/, v);
  for (const v of ["30a", "-30", "trinta"]) assert.match(N.validarIdade(v, REGRAS).erro, /anos completos, usando apenas números/, v);
  assert.match(N.validarIdade("0", REGRAS).erro, /anos completos, maior que zero/);
  assert.match(N.validarIdade("17", REGRAS).erro, /^Esta campanha é destinada a pessoas com 18 anos ou mais\. Se você já tem 18 anos, confira/);
  assert.deepEqual(N.validarIdade(" 30 ", REGRAS), { ok: true, valor: 30 });
  assert.deepEqual(N.validarIdade("100", REGRAS), { ok: true, valor: 100 });
  assert.match(N.validarIdade("121", REGRAS).erro, /^Informe uma idade de até 120 anos\. Confira se não digitou um número a mais/);
  assert.deepEqual(N.validarIdade("5", { minima: null, maxima: null }), { ok: true, valor: 5 });
});

test("idade pretendida: menor que a atual, igual (horizonte 0) e 100 anos", () => {
  assert.equal(
    N.validarIdadeObjetivo("29", 30, REGRAS).erro,
    "A idade em que você pretende viver de renda não pode ser menor que sua idade atual (30 anos). Informe 30 anos ou mais."
  );
  assert.deepEqual(N.validarIdadeObjetivo("30", 30, REGRAS), { ok: true, valor: 30 });
  assert.equal(N.horizonteEmAnos(30, 30), 0);
  assert.deepEqual(N.validarIdadeObjetivo("100", 30, REGRAS), { ok: true, valor: 100 });
  assert.equal(N.horizonteEmAnos(30, 50), 20);
  assert.equal(N.horizonteEmAnos(50, 30), null);
  assert.equal(N.validarIdadeObjetivo(" ", 30, REGRAS).erro, "Informe a idade em que você pretende viver de renda.");
});

test("nome: normaliza espaços, preserva acentos/hífens/apóstrofos, sem exigir sobrenome", () => {
  assert.deepEqual(N.validarNome("  Ana   Maria  "), { ok: true, valor: "Ana Maria" });
  assert.equal(N.validarNome("Ana").valor, "Ana");
  assert.equal(N.validarNome("João D'Ávila-Souza").valor, "João D'Ávila-Souza");
  assert.equal(N.validarNome("Maria d’Assunção Jr.").valor, "Maria d’Assunção Jr.");
  assert.equal(N.validarNome("Ana Clara").valor, "Ana Clara");
  assert.equal(N.validarNome("    ").erro, "Informe seu nome para continuar.");
  assert.equal(N.validarNome("Ana123").ok, false);
  assert.equal(N.validarNome("ana@x.com").ok, false);
  assert.equal(N.validarNome("-Ana").ok, false);
  assert.match(N.validarNome("A").erro, /pelo menos duas letras/);
  assert.match(N.validarNome("Ana123").erro, /Remova números e símbolos/);
  assert.match(N.validarNome("1Ana").erro, /começar com uma letra/);
});

test("telefone: todos os formatos da demanda normalizam para o mesmo E.164", () => {
  for (const entrada of [
    "27999998888",
    "(27) 99999-8888",
    "+55 (27) 99999-8888",
    "5527999998888",
    "+55 27 99999 8888",
    " +55 27 99999-8888 ",
  ]) {
    const r = N.normalizarTelefone(entrada, lib);
    assert.equal(r.ok, true, entrada);
    assert.equal(r.e164, "+5527999998888", entrada);
    assert.equal(r.exibicao, "(27) 99999-8888", entrada);
  }
});

test("telefone: DDD 55 com e sem código do país, fixo, incompleto e internacional", () => {
  assert.equal(N.normalizarTelefone("55999998888", lib).e164, "+5555999998888");
  assert.equal(N.normalizarTelefone("(55) 99999-8888", lib).e164, "+5555999998888");
  assert.equal(N.normalizarTelefone("5555999998888", lib).e164, "+5555999998888");
  assert.equal(N.normalizarTelefone("+55 55 99999-8888", lib).e164, "+5555999998888");
  assert.equal(N.normalizarTelefone("(27) 3333-4444", lib).e164, "+552733334444");
  assert.match(N.normalizarTelefone("9999-8888", lib).erro, /DDD \+ número/);
  assert.match(N.normalizarTelefone("2799999", lib).erro, /incompleto: faltam 4 dígitos/);
  assert.match(N.normalizarTelefone("273333444", lib).erro, /incompleto: falta 1 dígito\./);
  assert.match(N.normalizarTelefone("279999988881", lib).erro, /dígitos a mais/);
  assert.equal(N.normalizarTelefone("", lib).erro, "Informe seu WhatsApp para continuar.");
  assert.match(N.normalizarTelefone("+1 202 555 0123", lib).erro, /^No momento atendemos apenas números do Brasil \(\+55\)/);
  assert.equal(N.normalizarTelefone("+1 202 555 0123", lib, { apenasBrasil: false }).e164, "+12025550123");
  assert.equal(N.normalizarTelefone("27 9999x8888", lib).ok, false);
});

test("telefone: máscara não inventa dígitos e preserva o cursor", () => {
  assert.deepEqual(N.mascararTelefoneDigitando("27999998888", 11), { valor: "(27) 99999-8888", cursor: 15 });
  assert.equal(N.mascararTelefoneDigitando("2799", 4).valor, "(27) 99");
  assert.equal(N.mascararTelefoneDigitando("2733334444", 10).valor, "(27) 3333-4444");
  assert.equal(N.mascararTelefoneDigitando("5527999998888", 13).valor, "(27) 99999-8888");
  assert.equal(N.mascararTelefoneDigitando("+55 27 99999 8888", 17).valor, "+55 (27) 99999-8888");
  assert.equal(N.mascararTelefoneDigitando("+5", 2).valor, "+5");
  // Editar no meio: cursor depois do 4º dígito continua depois do 4º dígito
  const r = N.mascararTelefoneDigitando("(27) 919999-8888", 6);
  assert.equal(r.valor, "(27) 91999-9888 8");
  assert.equal(r.valor.slice(0, r.cursor).replace(/\D/g, ""), "279");
  assert.deepEqual(N.mascararTelefoneDigitando("", 0), { valor: "", cursor: 0 });
});

test("moeda: digitação, colagem pt-BR e en, zero ≠ não informado", () => {
  const casos = {
    "15000": 1500000,
    "15.000": 1500000,
    "15.000,00": 1500000,
    "R$ 15.000,50": 1500050,
    "R$ 15.000,5": 1500050,
    "15000,5": 1500050,
    "15000.50": 1500050,
    "1.234.567,89": 123456789,
    "0,99": 99,
  };
  for (const [entrada, centavos] of Object.entries(casos)) {
    assert.deepEqual(N.validarRenda(entrada, false), { ok: true, centavos, indefinida: false }, entrada);
  }
  assert.match(N.validarRenda("0", false).erro, /maior que zero/);
  assert.match(N.validarRenda("0,00", false).erro, /maior que zero/);
  assert.match(N.validarRenda("", false).erro, /Ainda não sei/);
  assert.match(N.validarRenda("15,000,00", false).erro, /15\.000,00/);
  assert.match(N.validarRenda("1.50.0", false).erro, /15\.000,00/);
  assert.match(N.validarRenda("abc", false).erro, /15\.000,00/);
  assert.deepEqual(N.validarRenda("", true), { ok: true, centavos: null, indefinida: true });
  assert.equal(N.formatarMoeda(1500000), "R$ 15.000,00");
});

test("moeda: máscara de digitação agrupa milhar e mantém o cursor", () => {
  assert.deepEqual(N.mascararMoedaDigitando("15000", 5), { valor: "15.000", cursor: 6 });
  assert.equal(N.mascararMoedaDigitando("15000,", 6).valor, "15.000,");
  assert.equal(N.mascararMoedaDigitando("15000,509", 9).valor, "15.000,50");
  assert.equal(N.mascararMoedaDigitando(",5", 2).valor, "0,5");
  assert.equal(N.mascararMoedaDigitando("007", 3).valor, "7");
  const r = N.mascararMoedaDigitando("1.5000", 2); // digitou 5 após o "1."
  assert.equal(r.valor, "15.000");
  assert.equal(r.valor.slice(0, r.cursor).replace(/\D/g, ""), "1");
});

test("e-mail opcional: aceita +, rejeita formato inválido, ignora vazio", () => {
  assert.deepEqual(N.validarEmail("   "), { ok: true, valor: null });
  assert.match(N.validarEmail("   ", true).erro, /Informe seu e-mail/);
  assert.equal(N.validarEmail(" ana+invest@exemplo.com.br ").valor, "ana+invest@exemplo.com.br");
  assert.match(N.validarEmail("ana@exemplo").erro, /Falta o final do e-mail/);
  assert.match(N.validarEmail("ana.exemplo.com").erro, /Falta o @/);
  assert.match(N.validarEmail("ana @exemplo.com").erro, /não pode ter espaços/);
  assert.equal(N.validarEmail("ana@@exemplo.com").ok, false);
  assert.equal(N.validarEmail("ana@exemplo..com").ok, false);
});

test("atribuição: código do caminho e UTMs", () => {
  assert.equal(N.lerCodigoDoCaminho("/planejamento/r/A7K2M9"), "a7k2m9");
  assert.equal(N.lerCodigoDoCaminho("/planejamento/r/a7k2m9/"), "a7k2m9");
  assert.deepEqual(N.lerCodigoDoCaminho("/planejamento/r/<script>"), { invalido: true });
  assert.equal(N.lerCodigoDoCaminho("/planejamento/"), null);
  assert.deepEqual(N.lerUtms("?utm_source=instagram&utm_medium=%20stories%20&x=1&utm_term="), {
    utm_source: "instagram",
    utm_medium: "stories",
  });
  assert.equal(N.dominioDeReferencia("https://l.instagram.com/x", "caisinvestimentos.com.br"), "l.instagram.com");
  assert.equal(N.dominioDeReferencia("", "a"), null);
});

const F = require("../perguntas.js");
const P = (k) => F.perguntas.find((p) => p.chave === k);

test("perguntas.js: configuração válida e verificação acusa erros comuns", () => {
  assert.deepEqual(N.verificarFormulario(F), []);
  const ruim = {
    versao: "v1",
    perguntas: [
      { chave: "nome", tipo: "texto", pergunta: "x" },
      { chave: "a", tipo: "escolha", pergunta: "y", opcoes: [{ chave: "s", rotulo: "Sim" }] },
      { chave: "b", tipo: "idade", pergunta: "z", minimoDe: "c" },
      { chave: "c", tipo: "slider", pergunta: "w" },
    ],
  };
  const problemas = N.verificarFormulario(ruim).join(" | ");
  assert.match(problemas, /chave reservada/);
  assert.match(problemas, /ao menos 2 opções/);
  assert.match(problemas, /"c" precisa ser uma pergunta anterior/);
  assert.match(problemas, /tipo desconhecido/);
});

test("validarResposta: escolha, idade com minimoDe, moeda com 'Ainda não sei', texto e opcional", () => {
  assert.deepEqual(N.validarResposta(P("patrimonio"), "ate_100k", {}), { ok: true, valor: "ate_100k" });
  assert.equal(N.validarResposta(P("patrimonio"), "inventada", {}).ok, false);
  assert.equal(N.validarResposta(P("patrimonio"), undefined, {}).erro, "Selecione uma opção para continuar.");
  assert.deepEqual(N.validarResposta(P("idade_atual"), " 30 ", {}), { ok: true, valor: 30 });
  assert.deepEqual(N.validarResposta(P("idade_atual"), 30, {}), { ok: true, valor: 30 });
  assert.match(N.validarResposta(P("idade_atual"), "17", {}).erro, /18 anos ou mais/);
  assert.match(N.validarResposta(P("idade_objetivo"), "29", { idade_atual: 30 }).erro, /\(30 anos\)\. Informe 30 anos ou mais/);
  assert.deepEqual(N.validarResposta(P("idade_objetivo"), "100", { idade_atual: 30 }), { ok: true, valor: 100 });
  assert.deepEqual(N.validarResposta(P("renda"), "15.000,00", {}), { ok: true, valor: 1500000 });
  assert.deepEqual(N.validarResposta(P("renda"), 1500000, {}), { ok: true, valor: 1500000 });
  assert.deepEqual(N.validarResposta(P("renda"), N.NAO_SEI, {}), { ok: true, valor: N.NAO_SEI });
  assert.equal(N.validarResposta(P("renda"), 0, {}).ok, false);
  assert.match(N.validarResposta(P("renda"), "0", {}).erro, /Ainda não sei/);

  const semNaoSei = { chave: "r", tipo: "moeda", pergunta: "?" };
  assert.equal(N.validarResposta(semNaoSei, N.NAO_SEI, {}).ok, false);
  assert.doesNotMatch(N.validarResposta(semNaoSei, "0", {}).erro, /Ainda não sei/);
  const texto = { chave: "obs", tipo: "texto", pergunta: "?", opcional: true, maximo: 5 };
  assert.deepEqual(N.validarResposta(texto, "  ", {}), { ok: true, valor: null, vazia: true });
  assert.equal(N.validarResposta(texto, "abcdef", {}).ok, false);
  const filhos = { chave: "filhos", tipo: "inteiro", pergunta: "?", sufixo: "filhos", minimo: 0 };
  assert.deepEqual(N.validarResposta(filhos, "0", {}), { ok: true, valor: 0 });
  assert.equal(N.rotuloResposta(filhos, 2), "2 filhos");
});

test("respostasLegiveis: ordem do formulário, derivados e resumo sem 'Ainda não sei'", () => {
  const r = { patrimonio: "ate_100k", experiencia: "ate_3m", aporte: "ate_10", idade_atual: 30, idade_objetivo: 50, renda: 1500000 };
  const crm = N.respostasLegiveis(F, r, "crm");
  assert.deepEqual(
    crm.map((x) => [x.pergunta, x.resposta]),
    [
      ["Qual é o seu patrimônio atual?", "Até R$ 100 mil"],
      ["Há quanto tempo você investe regularmente?", "Até 3 meses"],
      ["Quanto da sua renda você consegue investir todos os meses?", "Até 10%"],
      ["Quantos anos você tem?", "30 anos"],
      ["Com qual idade você pretende viver de renda?", "50 anos"],
      ["Horizonte de planejamento", "20 anos"],
      ["Quanto você gostaria de receber por mês ao viver de renda?", "R$ 15.000,00"],
      ["Renda anual desejada", "R$ 180.000,00"],
    ]
  );
  const resumo = N.respostasLegiveis(F, { ...r, renda: N.NAO_SEI }, "resumo").map((x) => x.pergunta);
  assert.deepEqual(resumo, ["Patrimônio", "Histórico de investimentos", "Capacidade de aporte", "Idade pretendida", "Horizonte de planejamento"]);
  const naoSeiCrm = N.respostasLegiveis(F, { ...r, renda: N.NAO_SEI }, "crm");
  assert.deepEqual(naoSeiCrm.slice(-1)[0], { chave: "renda", pergunta: "Quanto você gostaria de receber por mês ao viver de renda?", resposta: "Ainda não sei" });
});

test("montarEnvio: só valores por chave, sem rótulos; vazios omitidos", () => {
  const c = N.montarEnvio(
    { respostas: { patrimonio: "ate_100k", renda: N.NAO_SEI, vazia: null }, nome: "Ana", telefone_e164: "+5527999998888", email: null },
    { id: "x", versaoFormulario: "planejamento-v2", sessaoId: "s", utm: {} }
  );
  assert.deepEqual(c, {
    id: "x",
    pessoa: { nome: "Ana", telefone: "+5527999998888" },
    respostas: { patrimonio: "ate_100k", renda: "nao_sei" },
    envio: { form_versao: "planejamento-v2", sessao_id: "s" },
    site: "",
  });
});

test("campoDoCaminho: respostas.<chave> e pessoa.* apontam a tela certa", () => {
  assert.deepEqual(N.campoDoCaminho("pessoa.telefone"), ["identificacao", "telefone"]);
  assert.deepEqual(N.campoDoCaminho("respostas.idade_objetivo"), ["idade_objetivo", "idade_objetivo"]);
  assert.equal(N.campoDoCaminho("envio.duracao_segundos"), null);
  assert.equal(N.lerCodigoDoCaminho("/planejamento/r/abcdefghijklmnopq").invalido, true);
});
