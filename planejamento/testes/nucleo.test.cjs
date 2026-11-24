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

const BASE = {
  patrimonio_faixa: "acima_500k_ate_1m",
  experiencia_faixa: "nao_investe",
  aporte_faixa: "ate_10",
  idade_atual: 30,
  idade_objetivo: 50,
  nome: "Ana",
  telefone_e164: "+5527999998888",
  email: null,
};
const CTX = { id: "6f1c0b9e-2d7a-4c1e-9d0b-5a3e8f2c7b11", versaoFormulario: "planejamento-v1", sessaoId: "s-1", utm: {} };

test("envio (contrato): acesso direto omite link, e-mail vazio, utm vazia e referência vazia", () => {
  const c = N.montarEnvio({ ...BASE, renda_desejada_indefinida: false, renda_desejada_centavos: 1500000 }, CTX);
  assert.equal("link" in c, false);
  assert.deepEqual(c.pessoa, { nome: "Ana", telefone: "+5527999998888" });
  assert.equal("utm" in c, false);
  assert.equal("referencia_dominio" in c.envio, false);
  assert.equal(c.site, "");
  assert.deepEqual(Object.keys(c), ["id", "pessoa", "respostas", "envio", "site"]);
});

test("envio (contrato): renda é exatamente um dos dois campos, nunca 0", () => {
  const indef = N.montarEnvio({ ...BASE, renda_desejada_indefinida: true, renda_desejada_centavos: null }, CTX);
  assert.equal(indef.respostas.renda_desejada_indefinida, true);
  assert.equal("renda_desejada_centavos" in indef.respostas, false);
  const def = N.montarEnvio({ ...BASE, renda_desejada_indefinida: false, renda_desejada_centavos: 1500000 }, CTX);
  assert.equal(def.respostas.renda_desejada_centavos, 1500000);
  assert.equal("renda_desejada_indefinida" in def.respostas, false);
});

test("envio (contrato): link, utm e envio completos; sem derivados nem atribuição", () => {
  const c = N.montarEnvio(
    { ...BASE, email: "ana+inv@exemplo.com", renda_desejada_indefinida: false, renda_desejada_centavos: 100 },
    {
      ...CTX,
      linkCodigo: "a7k2m9",
      utm: { utm_source: "instagram", utm_medium: "stories" },
      referenciaDominio: "instagram.com",
      dispositivo: "mobile",
      duracaoSegundos: 94,
      privacidadeVersao: "2026-11-30",
      armadilha: "",
    }
  );
  assert.equal(c.link, "a7k2m9");
  assert.equal(c.pessoa.email, "ana+inv@exemplo.com");
  assert.deepEqual(c.utm, { utm_source: "instagram", utm_medium: "stories" });
  assert.deepEqual(c.envio, {
    form_versao: "planejamento-v1",
    privacidade_versao: "2026-11-30",
    duracao_segundos: 94,
    dispositivo: "mobile",
    sessao_id: "s-1",
    referencia_dominio: "instagram.com",
  });
  const json = JSON.stringify(c);
  for (const proibido of ["horizonte", "renda_anual", "origem", "parceiro", "campanha", "pergunta"]) {
    assert.equal(json.includes(proibido), false, proibido);
  }
});

test("envio (contrato): caminhos do 400 apontam para a etapa e o campo certos", () => {
  assert.deepEqual(N.campoDoCaminho("pessoa.telefone"), ["identificacao", "telefone"]);
  assert.deepEqual(N.campoDoCaminho("respostas.idade_objetivo"), ["idade_objetivo", "idade_objetivo"]);
  assert.deepEqual(N.campoDoCaminho("respostas.renda_desejada_centavos"), ["renda", "renda"]);
  assert.equal(N.campoDoCaminho("envio.duracao_segundos"), null);
  assert.equal(N.lerCodigoDoCaminho("/planejamento/r/abcdefghijklmnopq").invalido, true); // 17 > 16
});
