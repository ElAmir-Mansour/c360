package respond

type Repository = Store

func NewRepository() *Repository { return NewStore() }
