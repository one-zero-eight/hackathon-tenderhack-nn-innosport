from src.modules.dialog.abuse import is_abuse, load_lexicon


def test_dataset_is_loaded() -> None:
    words, _stems = load_lexicon()
    assert len(words) > 3000
    assert "хуй" in words
    assert "пиздец" in words


def test_mat_is_abuse() -> None:
    assert is_abuse("пошёл нахуй, когда почините портал")
    assert is_abuse("это пиздец какой-то")
    assert is_abuse("ёбаный портал")


def test_ordinary_support_text_is_not_abuse() -> None:
    assert not is_abuse("абстрактный запрос без ключей")
    assert not is_abuse("Как зарегистрироваться поставщику на портале?")
    assert not is_abuse("Нужна консультация по ЭП")
    assert not is_abuse("вы идиоты, когда почините ЭЦП?")
    assert not is_abuse("вы дураки, как зарегистрироваться на портале?")
    assert not is_abuse("Сервис работает отвратительно, помогите с ЭП")
